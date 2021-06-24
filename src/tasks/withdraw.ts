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
import {
  usdValue,
  formatUsdValue,
  formatTokenValue,
  appraise,
} from "./withdraw/value";

const ONEINCH_ETH_FLAG = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DAI_DECIMALS = 18;
const RATE_LIMIT_MAX_PARALLEL_WITHDRAWALS = 20;

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

function isErrorTooManyEvents(error: Error): boolean {
  return /query returned more than \d* results/.test(error.message);
}

// List all traded tokens. Block range bounds are both inclusive.
async function getAllTradedTokens(
  settlement: Contract,
  fromBlock: number,
  toBlock: number,
  hre: HardhatRuntimeEnvironment,
): Promise<string[]> {
  let trades = null;
  try {
    trades = await hre.ethers.provider.getLogs({
      topics: [settlement.interface.getEventTopic("Trade")],
      fromBlock,
      toBlock,
    });
  } catch (error) {
    if (!isErrorTooManyEvents(error)) {
      throw error;
    }
  }

  let tokens;
  if (trades === null) {
    if (fromBlock === toBlock) {
      throw new Error("Too many events in the same block");
    }
    const mid = Math.floor((toBlock + fromBlock) / 2);
    tokens = (
      await Promise.all([
        getAllTradedTokens(settlement, fromBlock, mid, hre),
        getAllTradedTokens(settlement, mid + 1, toBlock, hre), // note: mid+1 is not larger than toBlock thanks to flooring
      ])
    ).flat();
  } else {
    tokens = trades
      .map((trade) => {
        const decodedTrade = settlement.interface.decodeEventLog(
          "Trade",
          trade.data,
          trade.topics,
        );
        return [decodedTrade.sellToken, decodedTrade.buyToken];
      })
      .flat();
  }

  tokens = new Set(tokens);
  tokens.delete(BUY_ETH_ADDRESS);
  return Array.from(tokens).sort((lhs, rhs) =>
    lhs.toLowerCase() < rhs.toLowerCase() ? -1 : lhs === rhs ? 0 : 1,
  );
}

const LINE_CLEARING_ENABLED =
  process.stdout.isTTY &&
  process.stdout.clearLine !== undefined &&
  process.stdout.cursorTo !== undefined;

async function getWithdrawals(
  tokens: string[],
  settlement: Contract,
  minValue: string,
  leftover: string,
  hre: HardhatRuntimeEnvironment,
): Promise<Withdrawal[]> {
  const withdrawals: Withdrawal[] = [];
  const minValueWei = utils.parseUnits(minValue, DAI_DECIMALS);
  const leftoverWei = utils.parseUnits(leftover, DAI_DECIMALS);
  let vanishingProgressMessage = "";
  const addWithdrawal = async (i: number) => {
    const address = tokens[i];
    const token = await fastTokenDetails(address, hre);
    const balance = await token.contract.balanceOf(settlement.address);
    if (balance.eq(0)) {
      return;
    }
    const pricedToken = await appraise(token, hre.network.name);
    const balanceUsd = pricedToken.usdValue
      .mul(balance)
      .div(BigNumber.from(10).pow(pricedToken.decimals));
    // Note: if balanceUsd is zero, then setting either minValue or leftoverWei
    // to a nonzero value means that nothing should be withdrawn. If neither
    // flag is set, then whether to withdraw does not depend on the USD value.
    if (
      balanceUsd.lt(minValueWei.add(leftoverWei)) ||
      (balanceUsd.isZero() && !(minValueWei.isZero() && leftoverWei.isZero()))
    ) {
      if (LINE_CLEARING_ENABLED) {
        process.stdout.clearLine(0);
      }
      console.warn(
        `Ignored ${utils.formatUnits(balance, pricedToken.decimals)} units of ${
          token.symbol ?? "unknown token"
        } (${token.address}) with value ${formatUsdValue(
          balanceUsd,
          hre.network.name,
        )} USD`,
      );
      if (LINE_CLEARING_ENABLED) {
        process.stdout.write(vanishingProgressMessage);
        process.stdout.cursorTo(0);
      }
      return;
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
  };
  for (
    let step = 0;
    step < tokens.length / RATE_LIMIT_MAX_PARALLEL_WITHDRAWALS;
    step++
  ) {
    const remainingTokens =
      tokens.length - RATE_LIMIT_MAX_PARALLEL_WITHDRAWALS * step;
    const tokensInBatch =
      remainingTokens >= RATE_LIMIT_MAX_PARALLEL_WITHDRAWALS
        ? RATE_LIMIT_MAX_PARALLEL_WITHDRAWALS
        : remainingTokens;
    vanishingProgressMessage = `Processing tokens ${
      step * RATE_LIMIT_MAX_PARALLEL_WITHDRAWALS + 1
    } to ${step * RATE_LIMIT_MAX_PARALLEL_WITHDRAWALS + tokensInBatch} of ${
      tokens.length
    } tokens...`;
    if (LINE_CLEARING_ENABLED) {
      process.stdout.write(vanishingProgressMessage);
      process.stdout.cursorTo(0);
    }
    await Promise.all(
      Array(tokensInBatch)
        .fill(undefined)
        .map((_, i) =>
          addWithdrawal(step * RATE_LIMIT_MAX_PARALLEL_WITHDRAWALS + i),
        ),
    );
  }
  if (LINE_CLEARING_ENABLED) {
    process.stdout.clearLine(0);
  }
  return withdrawals;
}

function formatWithdrawal(
  withdrawal: Withdrawal,
  network: string,
): DisplayWithdrawal {
  return {
    address: withdrawal.token.address,
    value: formatUsdValue(withdrawal.balanceUsd, network),
    balance: formatTokenValue(
      withdrawal.balance,
      withdrawal.token.decimals,
      18,
    ),
    amount: formatTokenValue(withdrawal.amount, withdrawal.token.decimals, 18),
    symbol: withdrawal.token.symbol ?? "unknown token",
  };
}

function displayWithdrawals(withdrawals: Withdrawal[], network: string) {
  const formattedWithdtrawals = withdrawals.map((w) =>
    formatWithdrawal(w, network),
  );
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
      const value = await usdValue(
        { symbol: "ETH", address: ONEINCH_ETH_FLAG },
        amount,
        "mainnet",
      );
      return `${utils.formatEther(amount)} ETH (${formatUsdValue(
        value,
        network,
      )} USD)`;
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
    .addOptionalVariadicPositionalParam(
      "tokens",
      "An optional subset of tokens to consider for withdraw (otherwise all traded tokens will be queried).",
    )
    .setAction(
      async (
        { minValue, dryRun, leftover, receiver: inputReceiver, tokens },
        hre: HardhatRuntimeEnvironment,
      ) => {
        const receiver = utils.getAddress(inputReceiver);
        const [
          authenticator,
          settlementDeployment,
          [solver],
          latestBlock,
        ] = await Promise.all([
          getDeployedContract("GPv2AllowListAuthentication", hre),
          hre.deployments.get("GPv2Settlement"),
          hre.ethers.getSigners(),
          hre.ethers.provider.getBlockNumber(),
        ]);
        const settlement = new Contract(
          settlementDeployment.address,
          settlementDeployment.abi,
        ).connect(hre.ethers.provider);
        const deploymentBlock = settlementDeployment.receipt?.blockNumber;

        if (!(await authenticator.isSolver(solver.address))) {
          const message =
            "Current account is not a solver. Only a solver can withdraw funds from the settlement contract.";
          if (!dryRun) {
            throw Error(message);
          } else {
            console.warn(message);
          }
        }

        if (tokens === undefined) {
          console.log("Recovering list of traded tokens...");
          tokens = await getAllTradedTokens(
            settlement,
            deploymentBlock ?? 0,
            latestBlock,
            hre,
          );
        }

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

        displayWithdrawals(withdrawals, hre.network.name);

        if (withdrawals.length === 0) {
          console.log("No tokens to withdraw.");
          process.exit(0);
        }

        const encoder = new SettlementEncoder({});
        withdrawals.forEach(({ token, amount }) =>
          encoder.encodeInteraction({
            target: token.address,
            callData: token.contract.interface.encodeFunctionData("transfer", [
              receiver,
              amount,
            ]),
          }),
        );

        const finalSettlement = encoder.encodedSettlement({});
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
            hre.network.name,
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
