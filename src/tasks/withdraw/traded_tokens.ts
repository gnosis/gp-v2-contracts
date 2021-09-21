import { Contract } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { BUY_ETH_ADDRESS } from "../../ts";

function isErrorTooManyEvents(error: unknown): boolean {
  if (!(error instanceof Error)) {
    throw error;
  }
  return /query returned more than \d* results/.test(error.message);
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    throw error;
  }
  return /Network connection timed out/.test(error.message);
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
    // Infura throws "too many events" error. Other nodes time out.
    if (!(isErrorTooManyEvents(error) || isTimeout(error))) {
      throw error;
    }
    console.log(
      `Failed to process events from block ${fromBlock} to ${toBlock}, reducing range...`,
    );
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
