import { Contract } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { BUY_ETH_ADDRESS } from "../../ts";

const enum ProviderError {
  TooManyEvents,
  Timeout,
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
export async function getAllTradedTokens(
  settlement: Contract,
  fromBlock: number,
  toBlock: number | "latest",
  hre: HardhatRuntimeEnvironment,
): Promise<{ tokens: string[]; toBlock: number }> {
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
    const { tokens: firstHalf } = await getAllTradedTokens(
      settlement,
      fromBlock,
      mid,
      hre,
    );
    const { tokens: secondHalf, toBlock: numberSecondHalf } =
      await getAllTradedTokens(settlement, mid + 1, toBlock, hre);
    tokens = [...firstHalf, ...secondHalf];
    numericToBlock = numberSecondHalf;
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
