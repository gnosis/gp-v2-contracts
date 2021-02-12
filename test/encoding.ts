import { BigNumber, BytesLike } from "ethers";
import { ethers } from "hardhat";

import { Order, OrderKind, OrderRefunds } from "../src/ts";

export type AbiTupleOrder = [
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

export function decodeOrderKind(kindHash: string): OrderKind {
  for (const kind of [OrderKind.SELL, OrderKind.BUY]) {
    if (kindHash == ethers.utils.id(kind)) {
      return kind;
    }
  }
  throw new Error(`invalid order kind hash '${kindHash}'`);
}

export function decodeOrder(order: AbiTupleOrder): Order {
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

export function encodeFilledAmountRefunds(
  ...filledAmounts: BytesLike[]
): OrderRefunds {
  return { filledAmounts, preSignatures: [] };
}

export function encodePreSignatureRefunds(
  ...preSignatures: BytesLike[]
): OrderRefunds {
  return { filledAmounts: [], preSignatures };
}
