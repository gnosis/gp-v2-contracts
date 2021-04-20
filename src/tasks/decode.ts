import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";

import { promises as fs } from "fs";

import chalk from "chalk";
import { BigNumber, BigNumberish, Contract, utils, constants } from "ethers";
import { task } from "hardhat/config";

import {
  decodeTradeFlags,
  EncodedSettlement,
  Trade,
  BUY_ETH_ADDRESS,
  Interaction,
  SigningScheme,
} from "../ts";

const WIDTH = 120;
const INVALID_TOKEN = " ! Invalid token ! ";
const NATIVE_TOKEN = " native token ";

interface Token {
  contract: Contract;
  symbol: string | null;
  decimals: number | null;
  address: string;
  nativeFlag: boolean;
  price: BigNumber | undefined;
  index: number;
}

type MaybeToken =
  | Token
  | {
      index: number;
      decimals?: undefined;
      symbol?: undefined;
      nativeFlag?: undefined;
    };

type FormatToken = {
  address: string;
  index: string;
  symbol: string;
  price: string;
};

function formatToken(token: Token): FormatToken {
  return {
    address: token.address,
    index: token.index.toString(),
    symbol: token.nativeFlag ? NATIVE_TOKEN : token.symbol ?? INVALID_TOKEN,
    price: (token.price ?? "no price").toString(),
  };
}

function cellText(text: string, size: number): string {
  const inner =
    text.length > size - 2
      ? text.slice(0, size - 5) + "..."
      : text.padStart(size - 2, " ");
  return " " + inner + " ";
}

const mainLabel = (s: string) => chalk.bold(chalk.yellow(s + ":"));
const label = (s: string) => chalk.cyan(s + ":");

function displayTokensColumnWidth(
  formattedTokens: FormatToken[],
): Record<keyof FormatToken, number> {
  const width = {
    address: 42,
    index: 5,
    symbol: 20,
    price: 40,
  };

  const maxWidth = (key: keyof typeof width) =>
    formattedTokens.reduce((max, token) => Math.max(max, token[key].length), 0);
  for (const key in width) {
    const typedKey = key as keyof typeof width;
    // pad with a space left and right (+2)
    width[typedKey] =
      Math.max(Math.min(width[typedKey], maxWidth(typedKey)), typedKey.length) +
      2;
  }
  return width;
}

function displayTokens(tokens: Token[]) {
  const headers = ["address", "index", "symbol", "price"] as const;
  const formattedTokens = tokens.map(formatToken);
  const columnWidth = displayTokensColumnWidth(formattedTokens);
  console.log(chalk.bold("=== Tokens ==="));
  console.log(
    headers
      .map((header) => chalk.cyan(cellText(header, columnWidth[header])))
      .join(chalk.gray("|")),
  );
  console.log(
    chalk.gray(headers.map((key) => "-".repeat(columnWidth[key])).join("+")),
  );
  for (const token of formattedTokens) {
    console.log(
      headers
        .map((key) => cellText(token[key], columnWidth[key]))
        .join(chalk.gray("|")),
    );
  }
  console.log();
}

function displayTrades(trades: Trade[], tokens: Token[]) {
  console.log(chalk.bold("=== Trades ==="));
  console.log(chalk.gray("-".repeat(WIDTH)));
  for (const trade of trades) {
    displayTrade(trade, tokens);
    console.log();
  }
}

function formatSignature(sig: SigningScheme): string {
  switch (sig) {
    case SigningScheme.EIP712:
      return "eip-712";
    case SigningScheme.ETHSIGN:
      return "ethsign";
    case SigningScheme.EIP1271:
      return "eip-1271";
    case SigningScheme.PRESIGN:
      return "presign";
    default:
      return `invalid (${sig})`;
  }
}

function displayTrade(trade: Trade, tokens: Token[]) {
  const prettyToken = (token: MaybeToken, checkNative?: boolean) =>
    `${
      checkNative && token.nativeFlag
        ? NATIVE_TOKEN
        : token.symbol ?? INVALID_TOKEN
    } (${token.index})`;
  const prettyAmount = (
    amount: BigNumberish,
    token: MaybeToken,
    checkNative?: boolean,
  ) =>
    `${utils.formatUnits(amount, token.decimals ?? undefined)} ${prettyToken(
      token,
      checkNative,
    )}`;
  const {
    executedAmount,
    validTo,
    appData,
    receiver,
    sellAmount,
    buyAmount,
    feeAmount,
    sellTokenIndex,
    buyTokenIndex,
    flags,
    signature,
  } = trade;
  const { kind, partiallyFillable, signingScheme } = decodeTradeFlags(flags);
  const sellToken = tokens[sellTokenIndex] ?? { index: sellTokenIndex };
  const buyToken = tokens[buyTokenIndex] ?? { index: buyTokenIndex };
  console.log(
    mainLabel("Order"),
    `${kind.toString().toUpperCase()} ${
      partiallyFillable ? "partially fillable " : ""
    }order, valid until ${new Date(validTo * 1000).toISOString()} (${validTo})`,
  );
  console.log(label(`Trade`), `sell ${prettyAmount(sellAmount, sellToken)}`);
  console.log("      ", ` buy ${prettyAmount(buyAmount, buyToken, true)}`);
  console.log("      ", ` fee ${prettyAmount(feeAmount, sellToken)}`);
  if (partiallyFillable) {
    console.log(
      label(`Executed amount`),
      `${prettyAmount(executedAmount, sellToken)}`,
    );
  }
  if (receiver !== constants.AddressZero) {
    console.log(label(`Receiver`), receiver);
  }
  if (appData !== constants.HashZero) {
    console.log(label(`AppData`), appData);
  }
  console.log(
    label(`Signature (${formatSignature(signingScheme)})`),
    signature,
  );
}

function displayInteractions(
  interactions: [Interaction[], Interaction[], Interaction[]],
) {
  console.log(chalk.bold("=== Interactions ==="));
  console.log(chalk.gray("-".repeat(WIDTH)));
  displayInteractionGroup("Pre-interactions", interactions[0]);
  console.log();
  displayInteractionGroup("Intra-interactions", interactions[1]);
  console.log();
  displayInteractionGroup("Post-interactions", interactions[2]);
  console.log();
}

function displayInteractionGroup(name: string, interactions: Interaction[]) {
  const nonEmpty = interactions.length !== 0;
  console.log(` ${nonEmpty ? "┌" : " "}--- ${name} ---`);
  for (const interaction of interactions.slice(undefined, -1)) {
    displayInteraction(interaction, false);
  }
  if (nonEmpty) {
    displayInteraction(interactions[interactions.length - 1], true);
  }
}

function displayInteraction(interaction: Interaction, isLast: boolean) {
  let newInteraction = true;
  const branch = () => {
    if (newInteraction) {
      newInteraction = false;
      return isLast ? " └─── " : " ├─── ";
    } else {
      return isLast ? "      " : " │    ";
    }
  };
  const { target, value, callData } = interaction;
  console.log(branch(), mainLabel("Interaction"), `target address ${target}`);
  if (!BigNumber.from(value).isZero()) {
    console.log(branch(), label("Value"), utils.formatEther(value));
  }
  console.log(branch(), label("Calldata"), callData);
}

const setupDecodeTask: () => void = () => {
  task("decode", "Decodes GPv2 settlement calldata.")
    .addOptionalParam(
      "txhash",
      "The transaction hash of the transaction to decode. If this flag is set, stdin is ignored.",
    )
    .setAction(
      async ({ txhash }, { artifacts, ethers, deployments, network }) => {
        let calldata;
        if (txhash !== undefined) {
          const tx = await ethers.provider.getTransaction(txhash.trim());
          if (tx === null) {
            throw new Error(`Transaction not found on network ${network.name}`);
          }
          const deployment = await deployments
            .get("GPv2Settlement")
            .catch(() => null);
          calldata = tx.data;
          if (deployment === null || tx.to !== deployment.address) {
            console.log(
              `Warning: the input transaction hash does not point to an interaction with the current deployment of GPv2 settlement contract on ${network.name}.`,
            );
            console.log(`Deployment: ${deployment?.address}`);
            console.log(`Target:     ${tx.to}`);
          }
        } else {
          calldata = (await fs.readFile("/dev/stdin")).toString().trim();
        }
        if (!/^0x[0-9a-f]*/.exec(calldata)) {
          throw new Error("Invalid calldata");
        }

        const GPv2Settlement = await artifacts.readArtifact("GPv2Settlement");
        const settlementInterface = new utils.Interface(GPv2Settlement.abi);
        const IERC20 = await artifacts.readArtifact(
          "src/contracts/interfaces/IERC20.sol:IERC20",
        );

        const [
          tokenAddresses,
          clearingPrices,
          trades,
          interactions,
        ] = settlementInterface.decodeFunctionData(
          "settle",
          calldata,
        ) as EncodedSettlement;

        const tokens = await Promise.all(
          tokenAddresses.map(async (address: string, index: number) => {
            const contract = new Contract(address, IERC20.abi, ethers.provider);
            const symbol = await contract
              .symbol()
              .then((s: unknown) => (typeof s !== "string" ? null : s))
              .catch(() => null);
            const decimals = await contract
              .decimals()
              .then((s: unknown) => BigNumber.from(s))
              .catch(() => null);
            return {
              contract,
              symbol,
              decimals,
              address,
              index,
              nativeFlag: BUY_ETH_ADDRESS === address,
              price: clearingPrices[index] as BigNumber | undefined,
            };
          }),
        );

        displayTokens(tokens);

        if (clearingPrices.length > tokens.length) {
          console.log(
            `Warning: settlement has ${
              clearingPrices.length - tokens.length
            } more prices than tokens.`,
          );
          console.log(`Extra prices from index ${tokens.length}:`);
          console.log(
            clearingPrices
              .slice(tokens.length)
              .map((price) => price.toString()),
          );
        }

        displayTrades(trades, tokens);

        displayInteractions(interactions);
      },
    );
};

export { setupDecodeTask };
