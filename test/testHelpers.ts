import { BigNumber, BigNumberish } from "ethers";
import { ethers } from "hardhat";

import { OrderKind } from "../src/ts";

export function fillBytes(count: number, byte: number): string {
  return ethers.utils.hexlify([...Array(count)].map(() => byte));
}

export function fillDistinctBytes(count: number, start: number): string {
  return ethers.utils.hexlify(
    [...Array(count)].map((_, i) => (start + i) % 256),
  );
}

export function fillUint(bits: number, byte: number): BigNumber {
  return BigNumber.from(fillBytes(bits / 8, byte));
}

export const SAMPLE_ORDER = {
  sellToken: fillBytes(20, 0x01),
  buyToken: fillBytes(20, 0x02),
  receiver: fillBytes(20, 0x03),
  sellAmount: ethers.utils.parseEther("42"),
  buyAmount: ethers.utils.parseEther("13.37"),
  validTo: 0xffffffff,
  appData: ethers.constants.HashZero,
  feeAmount: ethers.utils.parseEther("1.0"),
  kind: OrderKind.SELL,
  partiallyFillable: false,
};

export function ceilDiv(p: BigNumberish, q: BigNumberish): BigNumber {
  return BigNumber.from(p).add(q).sub(1).div(q);
}
