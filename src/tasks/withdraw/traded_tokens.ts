import { Contract } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { BUY_ETH_ADDRESS } from "../../ts";

const enum ProviderError {
  TooManyEvents,
  Timeout,
  BlockNotFound,
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
  if (
    /One of the blocks specified in filter \(fromBlock, toBlock or blockHash\) cannot be found/.test(
      message,
    )
  ) {
    return ProviderError.BlockNotFound;
  }
  return null;
}

/// Lists all tokens that were traded by the settlement contract in the range
/// specified by the two input blocks. Range bounds are both inclusive.
export async function getAllTradedTokens(
  settlement: Contract,
  fromBlock: number,
  toBlock: number,
  hre: HardhatRuntimeEnvironment,
): Promise<string[]> {
  let trades = null;
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
      case ProviderError.BlockNotFound:
        if (fromBlock < toBlock) {
          console.log(
            `Block not found when retrieving blocks ${fromBlock} to ${toBlock}, skipping last block...`,
          );
          return await getAllTradedTokens(
            settlement,
            fromBlock,
            toBlock - 1,
            hre,
          );
        } else {
          console.error(
            `Block not found when processing events from block ${fromBlock} to ${toBlock}`,
          );
          return [];
        }
      case null:
        throw error;
    }
  }

  let tokens;
  if (trades === null) {
    if (fromBlock === toBlock) {
      throw new Error("Too many events in the same block");
    }
    const mid = Math.floor((toBlock + fromBlock) / 2);
    tokens = [
      await getAllTradedTokens(settlement, fromBlock, mid, hre),
      await getAllTradedTokens(settlement, mid + 1, toBlock, hre), // note: mid+1 is not larger than toBlock thanks to flooring
    ].flat();
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
