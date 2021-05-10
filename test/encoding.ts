import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import {
  Order,
  OrderBalance,
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
  string,
  string,
];

function optionsForKey<K extends FlagKey>(key: K): FlagOptions<K> {
  return FLAG_MASKS[key].options;
}
export const allOrderKinds = optionsForKey("kind");
export const allPartiallyFillable = optionsForKey("partiallyFillable");
export const allSigningSchemes = optionsForKey("signingScheme");

export function allOptions<
  K extends FlagKey,
  AllOptions extends Record<K, FlagOptions<K>>,
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
    ethers.utils.id(o.sellTokenBalance),
    ethers.utils.id(o.buyTokenBalance),
  ];
}

function decodeEnum<T>(hash: string, values: T[]): T {
  for (const value of values) {
    if (hash == ethers.utils.id(`${value}`)) {
      return value;
    }
  }
  throw new Error(`invalid enum hash '${hash}'`);
}

export function decodeOrderKind(kindHash: string): OrderKind {
  return decodeEnum(kindHash, [OrderKind.SELL, OrderKind.BUY]);
}

export function decodeOrderBalance(balanceHash: string): OrderBalance {
  return decodeEnum(balanceHash, [
    OrderBalance.ERC20,
    OrderBalance.EXTERNAL,
    OrderBalance.INTERNAL,
  ]);
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
    sellTokenBalance: decodeOrderBalance(order[10]),
    buyTokenBalance: decodeOrderBalance(order[11]),
  };
}

export const OrderBalanceId = {
  ERC20: ethers.utils.id(OrderBalance.ERC20),
  EXTERNAL: ethers.utils.id(OrderBalance.EXTERNAL),
  INTERNAL: ethers.utils.id(OrderBalance.INTERNAL),
};
