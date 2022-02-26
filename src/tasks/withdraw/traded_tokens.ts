import axios from "axios";
import { Contract } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { BUY_ETH_ADDRESS } from "../../ts";

const OFFICIAL_BUFFER_TRADING_ALLOW_LIST =
  "https://raw.githubusercontent.com/gnosis/cow-dex-solver/main/data/token_list_for_buffer_trading.json";

export async function fetchBufferTradableTokens(): Promise<string[]> {
  return axios
    .get(OFFICIAL_BUFFER_TRADING_ALLOW_LIST)
    .then((response) => {
      const token_list: {
        symbol: string;
        decimals: number;
        address: string;
      }[] = response.data.tokens;
      return token_list.map((tokenObject) => tokenObject.address);
    })
    .catch((err) => {
      throw Error(
        `Warning: unable to recover buffer token list, due to: ${err}`,
      );
    });
}

export function excludeBufferTradableTokensFromList(
  tokens: string[],
  bufferTradableTokenList: string[],
) {
  console.log("Excluding buffer tradable from withdraw list...");
  const tokenListLength = tokens.length;
  const excludedTokens = new Set(
    bufferTradableTokenList.map((token) => token.toLowerCase()),
  );
  tokens = tokens.filter((token) => !excludedTokens.has(token.toLowerCase()));
  console.log(
    "Removed",
    tokenListLength - tokens.length,
    "tokens from withdraw list as they are buffer tradable tokens",
  );
  return tokens;
}

const enum ProviderError {
  TooManyEvents,
  Timeout,
}

export interface TradedTokens {
  tokens: string[];
  toBlock: number;
}

export const partialTradedTokensKey = "partialTradedTokens" as const;
export interface TradedTokensError extends Error {
  [partialTradedTokensKey]: TradedTokens;
}

function decodeError(error: unknown): ProviderError | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const message = error.message;
  if (/query returned more than \d* results/.test(message)) {
    return ProviderError.TooManyEvents;
  }
  if (/Network connection timed out/.test(message)) {
    return ProviderError.Timeout;
  }
  return null;
}

/// Lists all tokens that were traded by the settlement contract in the range
/// specified by the two input blocks. Range bounds are both inclusive.
/// The output value `lastFullyIncludedBlock` returns the block numbers of the
/// latest block for which traded tokens were searched. Note that the returned
/// block value might not be exact in some circumstances like reorgs or
/// load-balanced nodes.
///
/// If an unexpected node error is encountered, the thown error may include the
/// tokens that were processed so far. See [TradedTokensError] for the error
/// format.
export async function getAllTradedTokens(
  settlement: Contract,
  fromBlock: number,
  toBlock: number | "latest",
  hre: HardhatRuntimeEnvironment,
): Promise<TradedTokens> {
  let trades = null;
  let numericToBlock =
    toBlock === "latest" ? hre.ethers.provider.getBlockNumber() : toBlock;
  try {
    trades = await hre.ethers.provider.getLogs({
      topics: [settlement.interface.getEventTopic("Trade")],
      address: settlement.address,
      fromBlock,
      toBlock,
    });
    console.log(`Processed events from block ${fromBlock} to ${toBlock}`);
  } catch (error) {
    switch (decodeError(error)) {
      // If the query is too large, Infura throws "too many events" error while
      // other nodes time out.
      case ProviderError.Timeout:
      case ProviderError.TooManyEvents:
        console.log(
          `Failed to process events from block ${fromBlock} to ${toBlock}, reducing range...`,
        );
        break;
      case null:
        throw error;
    }
  }

  let tokens;
  if (trades === null) {
    if (fromBlock === toBlock) {
      throw new Error("Too many events in the same block");
    }
    const mid = Math.floor(((await numericToBlock) + fromBlock) / 2);

    const firstHalf = await getAllTradedTokens(settlement, fromBlock, mid, hre);

    let secondHalf: TradedTokens;
    try {
      secondHalf = await getAllTradedTokens(settlement, mid + 1, toBlock, hre);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      if (!Object.keys(error).includes(partialTradedTokensKey)) {
        (error as TradedTokensError)[partialTradedTokensKey] = firstHalf;
      } else {
        const partialSecondHalf = (error as TradedTokensError)[
          partialTradedTokensKey
        ];
        const partialTradedTokens: TradedTokens = {
          tokens: [...firstHalf.tokens, ...partialSecondHalf.tokens],
          toBlock: partialSecondHalf.toBlock,
        };
        (error as TradedTokensError)[partialTradedTokensKey] =
          partialTradedTokens;
      }
      throw error;
    }

    tokens = [...firstHalf.tokens, ...secondHalf.tokens];
    numericToBlock = secondHalf.toBlock;
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
  return {
    tokens: Array.from(tokens).sort((lhs, rhs) =>
      lhs.toLowerCase() < rhs.toLowerCase() ? -1 : lhs === rhs ? 0 : 1,
    ),
    toBlock: await numericToBlock,
  };
}
