import { BigNumberish } from "ethers";

export interface SimpleOrder {
  takerAddress: string;
  makerAssetAmount: BigNumberish;
  takerAssetAmount: BigNumberish;
  makerAssetAddress: string;
  takerAssetAddress: string;
}
