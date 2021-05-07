import "@nomiclabs/hardhat-ethers";

import readline from "readline";

import axios from "axios";
import chalk from "chalk";
import { BigNumber, utils, constants, Contract } from "ethers";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { BUY_ETH_ADDRESS, SettlementEncoder } from "../ts";

import { getDeployedContract } from "./ts/deployment";
import { TokenDetails, tokenDetails } from "./ts/erc20";
import { Align, displayTable } from "./ts/table";

const MAINNET_DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
const ONEINCH_ETH_FLAG = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DAI_DECIMALS = 18;

interface Withdrawal {
  token: PricedToken;
  amount: BigNumber;
  amountUsd: BigNumber;
  balance: BigNumber;
  balanceUsd: BigNumber;
}

interface DisplayWithdrawal {
  symbol: string;
  balance: string;
  amount: string;
  value: string;
  address: string;
}

interface PricedToken extends TokenDetails {
  // Overrides existing field in TokenDetails. The number of decimals must be
  // known to estimate the price
  decimals: number;
  // Amount of DAI wei equivalent to one unit of this token (10**decimals)
  usdValue: BigNumber;
}

// https://api.1inch.exchange/swagger/ethereum/#/Tokens/TokensController_getTokens
type OneinchTokenList = Record<
  string,
  { symbol: string; decimals: number; address: string }
>;
const ONEINCH_TOKENS: Promise<OneinchTokenList> = axios
  .get("https://api.1inch.exchange/v3.0/1/tokens")
  .then((response) => response.data.tokens)
  .catch(() => {
    console.warn("Warning: unable to recover token list from 1inch");
    return {};
  });

async function fastTokenDetails(
  address: string,
  hre: HardhatRuntimeEnvironment,
): Promise<TokenDetails> {
  const oneinchTokens = await ONEINCH_TOKENS;
  if (
    hre.network.name === "mainnet" &&
    oneinchTokens[address.toLowerCase()] !== undefined
  ) {
    const IERC20 = await hre.artifacts.readArtifact(
      "src/contracts/interfaces/IERC20.sol:IERC20",
    );
    const contract = new Contract(address, IERC20.abi, hre.ethers.provider);
    return { ...oneinchTokens[address.toLowerCase()], contract };
  }
  return tokenDetails(address, hre);
}

// Recovers mainnet address from token symbol. Useful to get prices out of xdai
// and rinkeby tokens.
async function addressFromSymbol(
  symbol: string,
  network: string,
): Promise<string | null> {
  const oneinchTokens = await ONEINCH_TOKENS;
  const tokensFromSymbol = Object.entries(oneinchTokens).filter(
    ([, token]) => token.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  let result = tokensFromSymbol.length == 0 ? null : tokensFromSymbol[0][0];
  if (tokensFromSymbol.length > 1) {
    // More than one token available. Using the most valued token to be safe.
    const tokenValues = await Promise.all(
      tokensFromSymbol.map(([, token]) =>
        oneinchUsdValue(token, BigNumber.from(10).pow(15), network),
      ),
    );
    const mostValued = tokenValues.reduce(
      (max, value, i) => (value.gt(tokenValues[max]) ? i : max),
      0,
    );
    result = tokensFromSymbol[mostValued][0];
  }
  return result;
}

// https://api.1inch.exchange/swagger/ethereum/#/Swap/SwapController_getQuote
const oneinchUsdValue = async function (
  token: Pick<TokenDetails, "symbol" | "address">,
  amount: BigNumber,
  network: string,
): Promise<BigNumber> {
  let fromTokenAddress: string;
  if (Object.keys(await ONEINCH_TOKENS).includes(token.address.toLowerCase())) {
    // Assumption: if a mainnet token has value, it's supported by 1inch.
    // If it's not on mainnet, then either it was deployed to the same address
    // on mainnet (and is the same token, i.e., same value), or its address is
    // overwhelmingly likely not to be in the 1inch list.
    fromTokenAddress = token.address;
  } else if (network === "mainnet" || token.symbol === null) {
    // Assumption: a token with no name has no value.
    return constants.Zero;
  } else {
    // Assumption: if the token has value on xdai, then a token with the same
    // name and approximately the same value exists on mainnet. WXDAI is the
    // only exception.
    // There will be false positives, but on Rinkeby and xdai the low gas prices
    // make it an acceptable loss.
    const symbol =
      token.symbol.toLowerCase() === "wxdai" ? "DAI" : token.symbol;
    const address = await addressFromSymbol(symbol, network);
    if (address === null) {
      return constants.Zero;
    }
    fromTokenAddress = address;
  }

  const toTokenAddress = MAINNET_DAI;
  // Note: 1inch API calls fail if from and to addresses are the same
  if (fromTokenAddress === toTokenAddress) {
    return amount;
  }

  try {
    const response = await axios.get(
      "https://api.1inch.exchange/v3.0/1/quote",
      {
        params: {
          fromTokenAddress,
          toTokenAddress,
          amount: amount.toString(),
        },
      },
    );
    // Note: in principle 1inch could use less than the provided input amount.
    // In this case, we assume that the token has no more value that what is
    // available from the available liquidity.
    return BigNumber.from(response.data.toTokenAmount);
  } catch (e) {
    console.warn(
      `Warning: 1inch price retrieval failed for token ${token.symbol} (${token.address}). Token will be ignored.`,
    );
    return constants.Zero;
  }
};

async function appraise(
  token: TokenDetails,
  network: string,
): Promise<PricedToken> {
  const decimals = token.decimals ?? DAI_DECIMALS;
  const usdValue = await oneinchUsdValue(
    token,
    BigNumber.from(10).pow(decimals),
    network,
  );
  return { ...token, usdValue, decimals };
}

async function getAllTradedTokens(settlement: Contract): Promise<string[]> {
  const trades = await settlement.queryFilter(settlement.filters.Trade());
  const tokens = new Set(
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    trades.map((trade) => [trade.args!.sellToken, trade.args!.buyToken]).flat(),
  );
  tokens.delete(BUY_ETH_ADDRESS);
  return Array.from(tokens).sort((lhs, rhs) =>
    lhs.toLowerCase() < rhs.toLowerCase() ? -1 : lhs === rhs ? 0 : 1,
  );
}

function clearLine() {
  if (
    process.stdout.clearLine !== undefined &&
    process.stdout.cursorTo !== undefined
  ) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
  }
}

async function getWithdrawals(
  tokens: string[],
  settlement: Contract,
  minValue: string,
  leftover: string,
  hre: HardhatRuntimeEnvironment,
): Promise<Withdrawal[]> {
  const withdrawals = [];
  const minValueWei = utils.parseUnits(minValue, DAI_DECIMALS);
  const leftoverWei = utils.parseUnits(leftover, DAI_DECIMALS);
  for (let i = 0; i < tokens.length; i++) {
    const address = tokens[i];
    clearLine();
    process.stdout.write(`Processing token ${i + 1}/${tokens.length}...`);
    const token = await fastTokenDetails(address, hre);
    const balance = await token.contract.balanceOf(settlement.address);
    if (balance.eq(0)) {
      continue;
    }
    const pricedToken = await appraise(token, hre.network.name);
    const balanceUsd = pricedToken.usdValue
      .mul(balance)
      .div(BigNumber.from(10).pow(pricedToken.decimals));
    clearLine();
    // Note: if balanceUsd is zero, then setting either minValue or leftoverWei
    // to a nonzero value means that nothing should be withdrawn. If neither
    // flag is set, then whether to withdraw does not depend on the USD value.
    if (
      balanceUsd.lt(minValueWei.add(leftoverWei)) ||
      (balanceUsd.isZero() && !(minValueWei.isZero() && leftoverWei.isZero()))
    ) {
      console.warn(
        `Ignored ${utils.formatUnits(balance, pricedToken.decimals)} units of ${
          token.symbol ?? "unknown token"
        } (${token.address}) with value ${formatUsdValue(balanceUsd)} USD`,
      );
      continue;
    }
    let amount;
    let amountUsd;
    if (balanceUsd.isZero()) {
      // Note: minValueWei and leftoverWei are zero. Everything should be
      // withdrawn.
      amount = balance;
      amountUsd = balanceUsd;
    } else {
      amount = balance.mul(balanceUsd.sub(leftoverWei)).div(balanceUsd);
      amountUsd = balanceUsd.sub(leftoverWei);
    }
    withdrawals.push({
      token: pricedToken,
      amount,
      amountUsd,
      balance,
      balanceUsd,
    });
  }
  clearLine();
  return withdrawals;
}

// Format amount so that it has exactly a fixed amount of decimals.
function formatTokenValue(
  amount: BigNumber,
  actualDecimals: number,
  targetDecimals: number,
): string {
  const normalized =
    targetDecimals <= actualDecimals
      ? amount.div(BigNumber.from(10).pow(actualDecimals - targetDecimals))
      : amount.mul(BigNumber.from(10).pow(-actualDecimals + targetDecimals));
  const powDecimals = BigNumber.from(10).pow(targetDecimals);
  return `${normalized.div(powDecimals).toString()}.${normalized
    .mod(powDecimals)
    .toString()
    .padStart(targetDecimals, "0")}`;
}

function formatUsdValue(amount: BigNumber): string {
  return formatTokenValue(amount, DAI_DECIMALS, 2);
}

function formatWithdrawal(withdrawal: Withdrawal): DisplayWithdrawal {
  return {
    address: withdrawal.token.address,
    value: formatUsdValue(withdrawal.balanceUsd),
    balance: formatTokenValue(
      withdrawal.balance,
      withdrawal.token.decimals,
      18,
    ),
    amount: formatTokenValue(withdrawal.amount, withdrawal.token.decimals, 18),
    symbol: withdrawal.token.symbol ?? "unknown token",
  };
}

function displayWithdrawals(withdrawals: Withdrawal[]) {
  const formattedWithdtrawals = withdrawals.map(formatWithdrawal);
  const order = ["address", "value", "balance", "amount", "symbol"] as const;
  const header = {
    address: "address",
    value: "balance (usd)",
    balance: "balance",
    amount: "withdrawn amount",
    symbol: "symbol",
  };
  console.log(chalk.bold("Amounts to withdraw:"));
  displayTable(header, formattedWithdtrawals, order, {
    value: { align: Align.Right },
    balance: { align: Align.Right, maxWidth: 30 },
    amount: { align: Align.Right, maxWidth: 30 },
    symbol: { maxWidth: 20 },
  });
  console.log();
}

async function formatGasCost(
  amount: BigNumber,
  network: string,
): Promise<string> {
  switch (network) {
    case "mainnet": {
      const value = await oneinchUsdValue(
        { symbol: "ETH", address: ONEINCH_ETH_FLAG },
        amount,
        "mainnet",
      );
      return `${utils.formatEther(amount)} ETH (${formatUsdValue(value)} USD)`;
    }
    case "xdai":
      return `${utils.formatEther(amount)} XDAI`;
    default:
      return `${utils.formatEther(amount)} ETH`;
  }
}

async function prompt(message: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const response = await new Promise<string>((resolve) =>
    rl.question(`${message} (y/N) `, (response) => resolve(response)),
  );
  return "y" === response.toLowerCase();
}

const setupWithdrawTask: () => void = () =>
  task("withdraw", "Withdraw funds from the settlement contract")
    .addOptionalParam(
      "minValue",
      "If specified, sets a minimum USD value required to withdraw the balance of a token.",
      "0",
      types.string,
    )
    .addOptionalParam(
      "leftover",
      "If specified, withdrawing leaves an amount of each token of USD value specified with this flag.",
      "0",
      types.string,
    )
    .addParam("receiver", "The address receiving the withdrawn tokens.")
    .addFlag(
      "dryRun",
      "Just simulate the settlement instead of executing the transaction on the blockchain.",
    )
    .setAction(
      async (
        { minValue, dryRun, leftover, receiver: inputReceiver },
        hre: HardhatRuntimeEnvironment,
      ) => {
        const receiver = utils.getAddress(inputReceiver);
        const [authenticator, settlement, [solver]] = await Promise.all([
          getDeployedContract("GPv2AllowListAuthentication", hre),
          getDeployedContract("GPv2Settlement", hre),
          hre.ethers.getSigners(),
        ]);

        if (!(await authenticator.isSolver(solver.address))) {
          const message =
            "Current account is not a solver. Only a solver can withdraw funds from the settlement contract.";
          if (!dryRun) {
            throw Error(message);
          } else {
            console.warn(message);
          }
        }

        const tokens = await getAllTradedTokens(settlement);

        // TODO: add eth withdrawal
        // TODO: split large transaction in batches
        const withdrawals = await getWithdrawals(
          tokens,
          settlement,
          minValue,
          leftover,
          hre,
        );
        withdrawals.sort((lhs, rhs) => {
          const diff = lhs.balanceUsd.sub(rhs.balanceUsd);
          return diff.isZero() ? 0 : diff.isNegative() ? -1 : 1;
        });

        displayWithdrawals(withdrawals);

        if (withdrawals.length === 0) {
          console.log("No tokens to withdraw.");
          process.exit(0);
        }

        const finalSettlement = SettlementEncoder.encodedSetup(
          ...withdrawals.map(({ token, amount }) => ({
            target: token.address,
            callData: token.contract.interface.encodeFunctionData("transfer", [
              receiver,
              amount,
            ]),
          })),
        );

        // TODO: use the address of a solver as the from address in dry run so
        // that the price can always be estimated
        const [gas, gasPrice] = await Promise.all([
          settlement.estimateGas.settle(...finalSettlement),
          hre.ethers.provider.getGasPrice(),
        ]);
        const amount = gas.mul(gasPrice);
        const totalValue = withdrawals.reduce(
          (sum, { amountUsd }) => sum.add(amountUsd),
          constants.Zero,
        );
        console.log(
          `The transaction will cost approximately ${await formatGasCost(
            amount,
            hre.network.name,
          )} and will withdraw the balance of ${
            withdrawals.length
          } tokens for an estimated total value of ${formatUsdValue(
            totalValue,
          )} USD. All withdrawn funds will be sent to ${receiver}.`,
        );

        if (!dryRun && (await prompt("Submit?"))) {
          console.log(
            "Executing the withdraw transaction on the blockchain...",
          );
          const response = await settlement
            .connect(solver)
            .settle(...finalSettlement);
          console.log(
            "Transaction submitted to the blockchain. Waiting for acceptance in a block...",
          );
          const receipt = await response.wait();
          console.log(
            `Transaction successfully executed. Transaction hash: ${receipt.transactionHash}`,
          );
        }
      },
    );

export { setupWithdrawTask };
