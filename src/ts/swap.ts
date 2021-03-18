import { BigNumberish, BytesLike } from "ethers";

/**
 * A Balancer swap request used for settling a single order against Balancer
 * pools.
 */
export interface SwapRequest {
  /**
   * The ID of the pool for the swap.
   */
  poolId: BytesLike;
  /**
   * The index of the input token.
   *
   * Settlement swap calls encode tokens as an array, this number represents an
   * index into that array.
   */
  tokenInIndex: number;
  /**
   * The index of the output token.
   */
  tokenOutIndex: number;
  /**
   * The amount to swap. This will ether be a fixed input amount when swapping
   * a sell order, or a fixed output amount when swapping a buy order.
   */
  amount: BigNumberish;
  /**
   * Additional pool user data required for the swap.
   *
   * This additional user data is pool implementation specific, and allows pools
   * to extend the Vault pool interface.
   */
  userData: BytesLike;
}
