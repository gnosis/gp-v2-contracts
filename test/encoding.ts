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
  boolean,
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
    o.useInternalSellTokenBalance,
    o.useInternalBuyTokenBalance,
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
    useInternalSellTokenBalance: order[10],
    useInternalBuyTokenBalance: order[11],
  };
}
