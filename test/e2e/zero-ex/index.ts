import { BigNumberish, BytesLike } from "ethers";

export interface SimpleOrder {
  takerAddress: string;
  makerAssetAmount: BigNumberish;
  takerAssetAmount: BigNumberish;
  makerAssetAddress: BytesLike;
  takerAssetAddress: BytesLike;
}
