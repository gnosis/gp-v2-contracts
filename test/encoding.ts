import type { BigNumber } from "ethers";
import { ethers } from "hardhat";

import type { Order } from "../src/ts";

export type AbiOrder = [
  string,
  string,
  BigNumber,
  BigNumber,
  number,
  number,
  BigNumber,
  number,
  boolean,
];

export type AbiTrade = [
  AbiOrder,
  number,
  number,
  BigNumber,
  number,
  string,
  string,
];

export interface Trade {
  order: Order;
  sellTokenIndex: number;
  buyTokenIndex: number;
  executedAmount: BigNumber;
  feeDiscount: number;
  owner: string;
  orderUid: string;
}

export function decodeTrade(trade: AbiTrade): Trade {
  return {
    order: {
      sellToken: trade[0][0],
      buyToken: trade[0][1],
      sellAmount: trade[0][2],
      buyAmount: trade[0][3],
      validTo: trade[0][4],
      appData: trade[0][5],
      feeAmount: trade[0][6],
      kind: trade[0][7],
      partiallyFillable: trade[0][8],
    },
    sellTokenIndex: trade[1],
    buyTokenIndex: trade[2],
    executedAmount: trade[3],
    feeDiscount: trade[4],
    owner: trade[5],
    orderUid: trade[6],
  };
}

export type AbiExecutedTrade = [string, string, string, BigNumber, BigNumber];

export interface ExecutedTrade {
  owner: string;
  sellToken: string;
  buyToken: string;
  sellAmount: BigNumber;
  buyAmount: BigNumber;
}

export function encodeExecutedTrade(trade: ExecutedTrade): AbiExecutedTrade {
  return [
    trade.owner,
    trade.sellToken,
    trade.buyToken,
    trade.sellAmount,
    trade.buyAmount,
  ];
}

export function decodeExecutedTrades(
  trades: AbiExecutedTrade[],
): ExecutedTrade[] {
  return trades.map((trade) => ({
    owner: trade[0],
    sellToken: trade[1],
    buyToken: trade[2],
    sellAmount: trade[3],
    buyAmount: trade[4],
  }));
}

export type InTransfer = Pick<
  ExecutedTrade,
  "owner" | "sellToken" | "sellAmount"
>;

export function encodeInTransfers(transfers: InTransfer[]): AbiExecutedTrade[] {
  return transfers.map((transfer) =>
    encodeExecutedTrade({
      ...transfer,
      buyToken: ethers.constants.AddressZero,
      buyAmount: ethers.constants.Zero,
    }),
  );
}

export type OutTransfer = Pick<
  ExecutedTrade,
  "owner" | "buyToken" | "buyAmount"
>;

export function encodeOutTransfers(
  transfers: OutTransfer[],
): AbiExecutedTrade[] {
  return transfers.map((transfer) =>
    encodeExecutedTrade({
      ...transfer,
      sellToken: ethers.constants.AddressZero,
      sellAmount: ethers.constants.Zero,
    }),
  );
}
