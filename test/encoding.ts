import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import {
  Order,
  OrderKind,
  normalizeOrder,
  FLAG_MASKS,
  FlagKey,
  FlagOptions,
} from "../src/ts";

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

function optionsForKey<K extends FlagKey>(key: K): FlagOptions<K> {
  return FLAG_MASKS[key].options;
}
export const allOrderKinds = optionsForKey("kind");
export const allPartiallyFillable = optionsForKey("partiallyFillable");
export const allSigningSchemes = optionsForKey("signingScheme");

export function allOptions<
  K extends FlagKey,
  AllOptions extends Record<K, FlagOptions<K>>
>(): AllOptions {
  const result: Record<string, FlagOptions<K>> = {};
  Object.entries(FLAG_MASKS).map(
    ([key, value]) => (result[key] = value.options),
  );
  return result as AllOptions;
}

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

export interface ExecutedTrade {
  owner: string;
  receiver: string;
  sellToken: string;
  buyToken: string;
  sellAmount: BigNumber;
  buyAmount: BigNumber;
}

export type InTransfer = Pick<
  ExecutedTrade,
  "owner" | "sellToken" | "sellAmount"
>;

export function encodeInTransfers(transfers: InTransfer[]): ExecutedTrade[] {
  return transfers.map((transfer) => ({
    ...transfer,
    receiver: ethers.constants.AddressZero,
    buyToken: ethers.constants.AddressZero,
    buyAmount: ethers.constants.Zero,
  }));
}

export type OutTransfer = Pick<
  ExecutedTrade,
  "owner" | "receiver" | "buyToken" | "buyAmount"
>;

export function encodeOutTransfers(transfers: OutTransfer[]): ExecutedTrade[] {
  return transfers.map((transfer) => ({
    ...transfer,
    sellToken: ethers.constants.AddressZero,
    sellAmount: ethers.constants.Zero,
  }));
}
