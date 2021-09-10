import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chalk from "chalk";
import {
  BigNumber,
  constants,
  Contract,
  ContractTransaction,
  Signer,
  utils,
} from "ethers";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Api, CallError, Environment } from "../services/api";
import {
  BUY_ETH_ADDRESS,
  domain,
  Order,
  OrderKind,
  SigningScheme,
  signOrder,
  TypedDataDomain,
} from "../ts";

import {
  getDeployedContract,
  isSupportedNetwork,
  SupportedNetwork,
} from "./ts/deployment";
import { promiseAllWithRateLimit } from "./ts/rate_limits";
import { Align, displayTable } from "./ts/table";
import {
  isNativeToken,
  nativeToken,
  NativeToken,
  erc20Token,
  Erc20Token,
  WRAPPED_NATIVE_TOKEN_ADDRESS,
  balanceOf,
  transfer,
  displayName,
} from "./ts/tokens";
import { prompt } from "./ts/tui";
import { formatTokenValue } from "./ts/value";

const MAX_LATEST_BLOCK_DELAY_SECONDS = 2 * 60;
export const MAX_ORDER_VALIDITY_SECONDS = 24 * 3600;

const keccak = utils.id;
const APP_DATA = keccak("GPv2 dump script");

interface DumpInstruction {
  token: Erc20Token;
  amountWithoutFee: BigNumber;
  receivedAmount: BigNumber;
  balance: BigNumber;
  fee: BigNumber;
  needsAllowance: boolean;
}

interface DisplayDumpInstruction {
  fromSymbol: string;
  fromAddress: string;
  balance: string;
  needsAllowance: "yes" | "";
  receivedAmount: string;
  feePercent: string;
}

interface TransferToReceiver {
  token: Erc20Token | NativeToken;
  amount: BigNumber;
}

interface DumpInstructions {
  instructions: DumpInstruction[];
  toToken: Erc20Token | NativeToken;
  // Amount of toToken that will be transfered to the receiver address with a
  // standard erc20 transfer. This is only set if there is a receiver and the
  // specified toToken is also a token to be dumped.
  transferToReceiver?: TransferToReceiver;
}

export interface GetDumpInstructionInput {
  dumpedTokens: string[];
  toTokenAddress: string | undefined; // undefined defaults to native token (e.g., ETH)
  user: string;
  vaultRelayer: string;
  maxFeePercent: number;
  hasCustomReceiver: boolean;
  hre: HardhatRuntimeEnvironment;
  network: SupportedNetwork;
  api: Api;
}
/**
 * This function recovers all information needed to dump the input list of
 * tokens into toToken with GPv2. It returns structured information on all
 * operations to execute, sorted so that the last operation is the one
 * recovering the largest amount of toToken.
 *
 * Information on operations to perform include that needed for creating orders,
 * setting allowances and, if needed, transfering tokens.
 *
 * Note that this function is not supposed to execute any state-changing
 * operation (either onchain or in the backend).
 *
 * Care is taken in handling the following logic:
 * - handling the case where the receiver is not the signer address
 * - handling ETH buy addresses (especially with a custom receiver)
 * - rejecting dump requests for tokens for which the fee to pay is larger than
 *   a given threshold
 */
export async function getDumpInstructions({
  dumpedTokens: inputDumpedTokens,
  toTokenAddress,
  user,
  vaultRelayer: vaultRelayer,
  maxFeePercent,
  hasCustomReceiver,
  hre,
  network,
  api,
}: GetDumpInstructionInput): Promise<DumpInstructions> {
  // todo: support dumping ETH by wrapping them
  if (inputDumpedTokens.includes(BUY_ETH_ADDRESS)) {
    throw new Error(
      `Dumping the native token is not supported. Remove the ETH flag address ${BUY_ETH_ADDRESS} from the list of tokens to dump.`,
    );
  }

  let toToken: Erc20Token | NativeToken;
  if (toTokenAddress === undefined || toTokenAddress === BUY_ETH_ADDRESS) {
    toToken = nativeToken(hre);
  } else {
    const erc20 = await erc20Token(toTokenAddress, hre);
    if (erc20 === null) {
      throw new Error(
        `Input toToken at address ${toTokenAddress} is not a valid Erc20 token.`,
      );
    }
    toToken = erc20;
  }

  let transferToReceiver: TransferToReceiver | undefined = undefined;
  const dumpedTokens = Array.from(new Set(inputDumpedTokens)).filter(
    (token) => token !== (toTokenAddress ?? BUY_ETH_ADDRESS),
  );
  if (
    hasCustomReceiver &&
    inputDumpedTokens.includes(toTokenAddress ?? BUY_ETH_ADDRESS)
  ) {
    transferToReceiver = {
      token: toToken,
      amount: await balanceOf(toToken, user),
    };
  }

  const computedInstructions: (DumpInstruction | null)[] = (
    await promiseAllWithRateLimit(
      dumpedTokens.map((tokenAddress) => async ({ consoleLog }) => {
        const token = await erc20Token(tokenAddress, hre);
        if (token === null) {
          consoleLog(
            `Dump request skipped for invalid ERC-20 token at address ${tokenAddress}.`,
          );
          return null;
        }
        const [balance, approvedAmount]: [BigNumber, BigNumber] =
          await Promise.all([
            token.contract.balanceOf(user).then(BigNumber.from),
            token.contract.allowance(user, vaultRelayer).then(BigNumber.from),
          ]);
        const needsAllowance = approvedAmount.lt(balance);
        if (balance.isZero()) {
          consoleLog(
            `Dump request skipped for token ${displayName(
              token,
            )}. No balance for that token is available.`,
          );
          return null;
        }
        const sellToken = token.address;
        const buyToken = isNativeToken(toToken)
          ? WRAPPED_NATIVE_TOKEN_ADDRESS[network] // todo: replace WETH address with BUY_ETH_ADDRESS when services support ETH estimates
          : toToken.address;
        let fee, buyAmountAfterFee;
        try {
          const feeAndQuote = await api.getFeeAndQuoteSell({
            sellToken,
            buyToken,
            sellAmountBeforeFee: balance,
          });
          fee = feeAndQuote.feeAmount;
          buyAmountAfterFee = feeAndQuote.buyAmountAfterFee;
        } catch (e) {
          if (
            (e as CallError)?.apiError?.errorType ===
            "SellAmountDoesNotCoverFee"
          ) {
            consoleLog(
              `Dump request skipped for token ${displayName(
                token,
              )}. The trading fee is larger than the dumped amount.`,
            );
            return null;
          } else {
            throw e;
          }
        }
        const amountWithoutFee = balance.sub(fee);
        const approxBalance = Number(balance.toString());
        const approxFee = Number(fee.toString());
        const feePercent = (100 * approxFee) / approxBalance;
        if (feePercent > maxFeePercent) {
          consoleLog(
            `Dump request skipped for token ${displayName(
              token,
            )}. The trading fee is too large compared to the balance (${feePercent.toFixed(
              2,
            )}%).`,
          );
          return null;
        }
        return {
          token,
          balance,
          amountWithoutFee,
          receivedAmount: buyAmountAfterFee,
          fee,
          needsAllowance,
        };
      }),
      { rateLimit: 10 },
    )
  ).filter((inst) => inst !== null);
  // note: null entries have already been filtered out
  const instructions = computedInstructions as DumpInstruction[];
  instructions.sort((lhs, rhs) =>
    lhs.receivedAmount.eq(rhs.receivedAmount)
      ? 0
      : lhs.receivedAmount.lt(rhs.receivedAmount)
      ? -1
      : 1,
  );

  return { instructions, toToken, transferToReceiver };
}

function formatInstruction(
  {
    token: fromToken,
    balance,
    receivedAmount,
    fee,
    needsAllowance: inputNeedsAllowance,
  }: DumpInstruction,
  toToken: Erc20Token | NativeToken,
): DisplayDumpInstruction {
  const fromSymbol = fromToken.symbol ?? "! unknown symbol !";
  const fromAddress = fromToken.address;
  const fromDecimals = fromToken.decimals ?? 0;
  const needsAllowance = inputNeedsAllowance ? "yes" : "";
  const feePercent = fee.mul(10000).div(balance).lt(1)
    ? "<0.01"
    : utils.formatUnits(fee.mul(10000).div(balance), 2);
  return {
    fromSymbol,
    fromAddress,
    needsAllowance,
    balance: formatTokenValue(balance, fromDecimals, 18),
    receivedAmount: formatTokenValue(receivedAmount, toToken.decimals ?? 0, 18),
    feePercent,
  };
}

function displayOperations(
  instructions: DumpInstruction[],
  toToken: Erc20Token | NativeToken,
) {
  const formattedInstructions = instructions.map((inst) =>
    formatInstruction(inst, toToken),
  );
  const orderWithoutAllowances = [
    "fromAddress",
    "fromSymbol",
    "receivedAmount",
    "balance",
    "feePercent",
  ] as const;
  const order = instructions.some(({ needsAllowance }) => needsAllowance)
    ? ([
        ...orderWithoutAllowances.slice(0, 2),
        "needsAllowance",
        ...orderWithoutAllowances.slice(2),
      ] as const)
    : orderWithoutAllowances;
  const header = {
    fromAddress: "token address",
    fromSymbol: "symbol",
    balance: "dumped amount",
    feePercent: "fee %",
    receivedAmount: `received amount${
      toToken.symbol ? ` (${toToken.symbol})` : ""
    }`,
    needsAllowance: "needs allowance?",
  };
  console.log(chalk.bold("List of dumped tokens:"));
  displayTable(header, formattedInstructions, order, {
    balance: { align: Align.Right, maxWidth: 30 },
    receivedAmount: { align: Align.Right, maxWidth: 30 },
    fromSymbol: { maxWidth: 20 },
  });
  console.log();
}

interface CreateAllowancesOptions {
  requiredConfirmations?: number | undefined;
}
async function createAllowances(
  allowances: Erc20Token[],
  signer: Signer,
  vaultRelayer: string,
  { requiredConfirmations }: CreateAllowancesOptions = {},
) {
  let lastTransaction: ContractTransaction | undefined = undefined;
  for (const token of allowances) {
    console.log(
      `Approving vault relayer to trade token ${displayName(token)}...`,
    );
    lastTransaction = (await token.contract
      .connect(signer)
      .approve(vaultRelayer, constants.MaxUint256)) as ContractTransaction;
    await lastTransaction.wait();
  }
  if (lastTransaction !== undefined) {
    // note: the last approval is (excluded reorgs) the last that is included
    // in a block, so awaiting it for confirmations means that also all others
    // have at least this number of confirmations.
    await lastTransaction.wait(requiredConfirmations);
  }
}

async function createOrders(
  instructions: DumpInstruction[],
  toToken: Erc20Token | NativeToken,
  signer: Signer,
  receiver: string,
  hasCustomReceiver: boolean,
  domainSeparator: TypedDataDomain,
  validity: number,
  ethers: HardhatRuntimeEnvironment["ethers"],
  api: Api,
) {
  const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
  // Check that the local time is consistent with that of the blockchain
  // to avoid signing orders that are valid for too long
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - blockTimestamp) > MAX_LATEST_BLOCK_DELAY_SECONDS) {
    throw new Error("Blockchain time is not consistent with local time.");
  }

  for (const inst of instructions) {
    const order: Order = {
      sellToken: inst.token.address,
      buyToken: isNativeToken(toToken) ? BUY_ETH_ADDRESS : toToken.address,
      sellAmount: inst.amountWithoutFee,
      buyAmount: inst.receivedAmount,
      feeAmount: inst.fee,
      kind: OrderKind.SELL,
      appData: APP_DATA,
      // todo: switch to true when partially fillable orders will be
      // supported by the services
      partiallyFillable: false,
      validTo: now + validity,
      receiver: hasCustomReceiver ? receiver : undefined,
    };
    const signature = await signOrder(
      domainSeparator,
      order,
      signer,
      SigningScheme.ETHSIGN,
    );

    console.log(
      `Creating order selling ${inst.token.symbol ?? inst.token.address}...`,
    );
    const orderUid = await api.placeOrder({
      order,
      signature,
    });
    console.log(`Successfully created order with uid ${orderUid}`);
  }
}
async function transferSameTokenToReceiver(
  transferToReceiver: TransferToReceiver,
  signer: Signer,
  receiver: string,
) {
  if (transferToReceiver !== undefined) {
    console.log(
      `Transfering token ${transferToReceiver.token.symbol} to receiver...`,
    );
    const receipt = await transfer(
      transferToReceiver.token,
      signer,
      receiver,
      transferToReceiver.amount,
    );
    await receipt.wait();
  }
}

interface DumpInput {
  validity: number;
  maxFeePercent: number;
  dumpedTokens: string[];
  toToken: string;
  settlement: Contract;
  signer: SignerWithAddress;
  receiver: string | undefined;
  network: SupportedNetwork;
  hre: HardhatRuntimeEnvironment;
  api: Api;
  dryRun: boolean;
  doNotPrompt?: boolean | undefined;
  confirmationsAfterApproval?: number | undefined;
}
export async function dump({
  validity,
  maxFeePercent,
  dumpedTokens,
  toToken: toTokenAddress,
  settlement,
  signer,
  receiver: inputReceiver,
  network,
  hre,
  api,
  dryRun,
  doNotPrompt,
  confirmationsAfterApproval,
}: DumpInput): Promise<void> {
  const { ethers } = hre;
  if (validity > MAX_ORDER_VALIDITY_SECONDS) {
    throw new Error("Order validity too large");
  }
  const [chainId, vaultRelayer] = await Promise.all([
    ethers.provider.getNetwork().then((n) => n.chainId),
    (await settlement.vaultRelayer()) as string,
  ]);
  const domainSeparator = domain(chainId, settlement.address);
  const receiver: string = inputReceiver ?? signer.address;
  const hasCustomReceiver = receiver !== signer.address;

  // todo: when sending ETH to a contract will be supported by the
  // services, remove this check.
  if (
    (toTokenAddress === undefined || toTokenAddress === BUY_ETH_ADDRESS) &&
    utils.arrayify(await ethers.provider.getCode(receiver)).length !== 0
  ) {
    throw new Error("Cannot send eth to a contract");
  }

  const { instructions, toToken, transferToReceiver } =
    await getDumpInstructions({
      dumpedTokens,
      toTokenAddress,
      user: signer.address,
      vaultRelayer: vaultRelayer,
      maxFeePercent,
      hasCustomReceiver,
      hre,
      network,
      api,
    });
  if (instructions.length === 0) {
    console.log("No token can be sold");
    return;
  }

  displayOperations(instructions, toToken);

  let sumReceived = instructions.reduce(
    (sum, inst) => sum.add(inst.receivedAmount),
    constants.Zero,
  );
  const needAllowances = instructions
    .filter(({ needsAllowance }) => needsAllowance)
    .map(({ token }) => token);
  if (needAllowances.length !== 0) {
    console.log(
      `Before creating the orders, a total of ${needAllowances.length} allowances will be granted to the vault relayer.`,
    );
  }
  const toTokenName = isNativeToken(toToken)
    ? toToken.symbol
    : toToken.symbol ?? `units of token ${toToken.address}`;
  if (transferToReceiver !== undefined) {
    console.log(
      `Moreover, ${utils.formatUnits(
        transferToReceiver.amount,
        transferToReceiver.token.decimals ?? 0,
      )} ${toTokenName} will be transfered to the receiver address ${receiver}.`,
    );
    sumReceived = sumReceived.add(transferToReceiver.amount);
  }
  console.log(
    `${
      hasCustomReceiver
        ? `The receiver address ${receiver}`
        : `Your address (${signer.address})`
    } will receive at least ${utils.formatUnits(
      sumReceived,
      toToken.decimals ?? 0,
    )} ${toTokenName} from selling the tokens listed above.`,
  );
  if (!dryRun && (doNotPrompt || (await prompt(hre, "Submit?")))) {
    await createAllowances(needAllowances, signer, vaultRelayer, {
      // If the services don't register the allowance before the order,
      // then creating a new order with the API returns an error.
      // Moreover, there is no distinction in the error between a missing
      // allowance and a failed order creation, which could occur for
      // valid reasons.
      requiredConfirmations: confirmationsAfterApproval,
    });

    await createOrders(
      instructions,
      toToken,
      signer,
      receiver,
      hasCustomReceiver,
      domainSeparator,
      validity,
      ethers,
      api,
    );

    if (transferToReceiver !== undefined) {
      await transferSameTokenToReceiver(transferToReceiver, signer, receiver);
    }

    console.log(
      `Done! The orders will expire in the next ${validity / 60} minutes.`,
    );
  }
}

const setupDumpTask: () => void = () =>
  task("dump")
    .addOptionalParam(
      "origin",
      "Address from which to withdraw. If not specified, it defaults to the first provided account",
    )
    .addOptionalParam(
      "toToken",
      "All input tokens will be dumped to this token. If not specified, it defaults to the network's native token (e.g., ETH)",
    )
    .addOptionalParam(
      "receiver",
      "The address that will receive the funds obtained from dumping the token. Defaults to the origin address",
    )
    .addOptionalParam(
      "validity",
      `How long the sell orders will be valid after their creation in seconds. It cannot be larger than ${MAX_ORDER_VALIDITY_SECONDS}`,
      20 * 60,
      types.int,
    )
    .addOptionalParam(
      "maxFeePercent",
      "If, for any token, the amount of fee to be paid is larger than this percent of the traded amount, that token is not traded",
      5,
      types.float,
    )
    .addFlag(
      "dryRun",
      "Just simulate the result instead of executing the transaction on the blockchain.",
    )
    .addVariadicPositionalParam(
      "dumpedTokens",
      "List of tokens that will be dumped in exchange for toToken. Multiple tokens are separated by spaces",
    )
    .setAction(
      async (
        {
          origin,
          toToken,
          dumpedTokens,
          maxFeePercent,
          dryRun,
          receiver,
          validity,
        },
        hre,
      ) => {
        const network = hre.network.name;
        if (!isSupportedNetwork(network)) {
          throw new Error(`Unsupported network ${hre.network.name}`);
        }
        const api = new Api(network, Environment.Prod);
        const [signers, settlement] = await Promise.all([
          hre.ethers.getSigners(),
          getDeployedContract("GPv2Settlement", hre),
        ]);
        const signer =
          origin === undefined
            ? signers[0]
            : signers.find((signer) => signer.address === origin);
        if (signer === undefined) {
          throw new Error(
            `No signer found${
              origin === undefined ? "" : ` for address ${origin}`
            }. Did you export a valid private key?`,
          );
        }
        console.log(`Using account ${signer.address}`);

        await dump({
          validity,
          maxFeePercent,
          dumpedTokens,
          toToken,
          settlement,
          signer,
          receiver,
          network,
          hre,
          api,
          dryRun,
          confirmationsAfterApproval: 2,
        });
      },
    );

export { setupDumpTask };
