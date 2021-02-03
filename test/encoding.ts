import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import { Order, OrderKind, normalizeOrder } from "../src/ts";

export type AbiOrder = [
  string,
  string,
  string,
  BigNumber,
  BigNumber,
  number,
  string,
  BigNumber,
  string,
  boolean,
];

export function encodeOrder(order: Order): AbiOrder {
  const o = normalizeOrder(order);
  return [
    o.sellToken,
    o.buyToken,
    o.receiver,
    BigNumber.from(o.sellAmount),
    BigNumber.from(o.buyAmount),
    o.validTo,
    o.appData,
    BigNumber.from(o.feeAmount),
    ethers.utils.id(o.kind),
    o.partiallyFillable,
  ];
}

export function decodeOrderKind(kindHash: string): OrderKind {
  for (const kind of [OrderKind.SELL, OrderKind.BUY]) {
    if (kindHash == ethers.utils.id(kind)) {
      return kind;
    }
  }
  throw new Error(`invalid order kind hash '${kindHash}'`);
}

export function decodeOrder(order: AbiOrder): Order {
  return {
    sellToken: order[0],
    buyToken: order[1],
    receiver: order[2],
    sellAmount: order[3],
    buyAmount: order[4],
    validTo: order[5],
    appData: order[6],
    feeAmount: order[7],
    kind: decodeOrderKind(order[8]),
    partiallyFillable: order[9],
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
