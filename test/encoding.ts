import type { BigNumber } from "ethers";
import { ethers } from "hardhat";

import { Order, OrderKind } from "../src/ts";

export type AbiOrder = [
  string,
  string,
  string,
  BigNumber,
  BigNumber,
  number,
  number,
  BigNumber,
  string,
  boolean,
];

export type AbiTrade = [
  AbiOrder,
  number,
  number,
  BigNumber,
  BigNumber,
  string,
  string,
];

export interface Trade {
  order: Order;
  sellTokenIndex: number;
  buyTokenIndex: number;
  executedAmount: BigNumber;
  feeDiscount: BigNumber;
  owner: string;
  orderUid: string;
}

export function decodeOrderKind(kindHash: string): OrderKind {
  for (const kind of [OrderKind.SELL, OrderKind.BUY]) {
    if (kindHash == ethers.utils.keccak256(ethers.utils.toUtf8Bytes(kind))) {
      return kind;
    }
  }
  throw new Error(`invalid order kind hash '${kindHash}'`);
}

export function decodeTrade(trade: AbiTrade): Trade {
  return {
    order: {
      sellToken: trade[0][0],
      buyToken: trade[0][1],
      receiver: trade[0][2],
      sellAmount: trade[0][3],
      buyAmount: trade[0][4],
      validTo: trade[0][5],
      appData: trade[0][6],
      feeAmount: trade[0][7],
      kind: decodeOrderKind(trade[0][8]),
      partiallyFillable: trade[0][9],
    },
    sellTokenIndex: trade[1],
    buyTokenIndex: trade[2],
    executedAmount: trade[3],
    feeDiscount: trade[4],
    owner: trade[5],
    orderUid: trade[6],
  };
}

export type AbiExecutedTrade = [
  string,
  string,
  string,
  string,
  BigNumber,
  BigNumber,
];

export interface ExecutedTrade {
  owner: string;
  receiver: string;
  sellToken: string;
  buyToken: string;
  sellAmount: BigNumber;
  buyAmount: BigNumber;
}

export function encodeExecutedTrade(trade: ExecutedTrade): AbiExecutedTrade {
  return [
    trade.owner,
    trade.receiver,
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
    receiver: trade[1],
    sellToken: trade[2],
    buyToken: trade[3],
    sellAmount: trade[4],
    buyAmount: trade[5],
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
      receiver: ethers.constants.AddressZero,
      buyToken: ethers.constants.AddressZero,
      buyAmount: ethers.constants.Zero,
    }),
  );
}

export type OutTransfer = Pick<
  ExecutedTrade,
  "owner" | "receiver" | "buyToken" | "buyAmount"
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
