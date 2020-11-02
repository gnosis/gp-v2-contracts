import { ethers, BigNumberish, SignatureLike } from "ethers";

/**
 * Gnosis Protocol v2 order data.
 */
export interface Order {
  /** Sell token address. */
  sellToken: string;
  /** Buy token address. */
  buyToken: string;

  /**
   * The order sell amount.
   *
   * For fill or kill sell orders, this amount represents the exact sell amount
   * that will be executed in the trade. For fill or kill buy orders, this
   * amount represents the maximum sell amount that can be executed. For partial
   * fill orders, this represents a component of the limit price fraction.
   */
  sellAmount: BigNumberish;
  /**
   * The order buy amount.
   *
   * For fill or kill sell orders, this amount represents the minimum buy amount
   * that can be executed in the trade. For fill or kill buy orders, this amount
   * represents the exact buy amount that will be executed. For partial fill
   * orders, this represents a component of the limit price fraction.
   */
  buyAmount: BigNumberish;

  /** The timestamp this order is valid until */
  validTo: number | Date;
  /**
   * The nonce this order is valid for.
   *
   * Specifying a value of {@link REPLAYABLE_NONCE} indicates that this order
   * can be replayed in any batch. This can be used for setting up passive
   * trading strategies where orders are valid forever.
   */
  nonce: number;

  /**
   * Additional fee to give to the protocol.
   *
   * This tip is used to offset solution submission gas costs so orders that
   * aren't economically viable (i.e. small orders that do not generate enough
   * fees) still get executed.
   */
  tip: BigNumberish;

  /** Additional order flags. See {@link OrderFlags}. */
  flags: OrderFlags;
}

/**
 * Order flags for enabling certain order features. By default, all orders are
 * fill-or-kill sell orders.
 */
export enum OrderFlags {
  /** Specifies the order is a sell order */
  SELL_ORDER = 0x00,
  /** Specifies the order is a buy order */
  BUY_ORDER = 0x01,
  /** Specifies the order is partially fillable */
  PARTIAL_FILL = 0x02,

  /** The mask for reserved values that must be 0. */
  RESERVED_MASK = 0xfc,
}

/**
 * Reserved nonce value used to indicate that an order can be replayed in any
 * batch.
 */
export const REPLAYABLE_NONCE = 0;

/**
 * Additional order flags used to efficiently encode order information. These
 * flags are added at encoding time but not included in the signature.
 */
export enum OrderEncodingFlags {
  /** Encode that the nonce should be {@link REPLAYABLE_NONCE} */
  REPLAYABLE_NONCE = 0x80,
}

function timestamp(time: number | Date): number {
  return typeof time === "number" ? time : ~~(time.getTime() / 1000);
}

/**
 * Encodes an executed order, that is an order with its executed traded amount
 * and signature. This data is exactly what the settlement contract expects
 * per order in order to settle a batch.
 * @param order The order data to be encoded.
 * @param executedAmount The amount of the order that is actually traded.
 * @param signature The signature for the order data.
 * @return A hex-string representing the encded executed order.
 */
export function encodeExecutedOrder(
  order: Order,
  executedAmount: BigNumberish,
  signature: SignatureLike,
): string {
  // NOTE: The nonce is encoded as a bit in the flags. This is done to save 4
  // bytes per order as the nonce can only be the current nonce or 0 for the
  // order to be valid.
  const encodingFlags =
    order.nonce === 0 ? OrderEncodingFlags.REPLAYABLE_NONCE : 0;
  const sig = ethers.utils.splitSignature(signature);

  return ethers.utils.solidityPack(
    [
      "uint112",
      "uint112",
      "uint32",
      "uint112",
      "uint8",
      "uint112",
      "uint8",
      "bytes32",
      "bytes32",
    ],
    [
      order.sellAmount,
      order.buyAmount,
      timestamp(order.validTo),
      order.tip,
      order.flags | encodingFlags,
      executedAmount,
      sig.v,
      sig.r,
      sig.s,
    ],
  );
}
