import { ethers, BigNumberish } from "ethers";

/**
 * Gnosis Protocol v2 order data.
 */
export interface Order {
  /**
   * Sell token address.
   */
  sellToken: string;
  /**
   * Buy token address.
   */
  buyToken: string;
  /**
   * An optional address to receive the proceeds of the trade instead of the
   * owner (i.e. the order signer).
   */
  receiver?: string;
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
  /**
   * The timestamp this order is valid until
   */
  validTo: Timestamp;
  /**
   * Arbitrary application specific data that can be added to an order. This can
   * also be used to ensure uniqueness between two orders with otherwise the
   * exact same parameters.
   */
  appData: number;
  /**
   * Fee to give to the protocol.
   */
  feeAmount: BigNumberish;
  /**
   * The order kind.
   */
  kind: OrderKind;
  /**
   * Specifies whether or not the order is partially fillable.
   */
  partiallyFillable: boolean;
}

/**
 * Marker address to indicate that an order is buying Ether.
 *
 * Note that this address is only has special meaning in the `buyToken` and will
 * be treated as a ERC20 token address in the `sellToken` position, causing the
 * settlement to revert.
 */
export const BUY_ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/**
 * Gnosis Protocol v2 order flags.
 */
export type OrderFlags = Pick<Order, "kind" | "partiallyFillable">;

/**
 * A timestamp value.
 */
export type Timestamp = number | Date;

/**
 * Order kind.
 */
export enum OrderKind {
  /**
   * A sell order.
   */
  SELL = "sell",
  /**
   * A buy order.
   */
  BUY = "buy",
}

/**
 * The EIP-712 type fields definition for a Gnosis Protocol v2 order.
 */
export const ORDER_TYPE_FIELDS = [
  { name: "sellToken", type: "address" },
  { name: "buyToken", type: "address" },
  { name: "receiver", type: "address" },
  { name: "sellAmount", type: "uint256" },
  { name: "buyAmount", type: "uint256" },
  { name: "validTo", type: "uint32" },
  { name: "appData", type: "uint32" },
  { name: "feeAmount", type: "uint256" },
  { name: "kind", type: "string" },
  { name: "partiallyFillable", type: "bool" },
];

/**
 * The EIP-712 type hash for a Gnosis Protocol v2 order.
 */
export const ORDER_TYPE_HASH = ethers.utils.id(
  `Order(${ORDER_TYPE_FIELDS.map(({ name, type }) => `${type} ${name}`).join(
    ",",
  )})`,
);

/**
 * Normalizes a timestamp value to a Unix timestamp.
 * @param time The timestamp value to normalize.
 * @return Unix timestamp or number of seconds since the Unix Epoch.
 */
export function timestamp(t: Timestamp): number {
  return typeof t === "number" ? t : ~~(t.getTime() / 1000);
}

/**
 * Compute the 32-byte digest for the specified order.
 * @param order The order to compute the digest for.
 * @return Hex-encoded 32-byte order digest.
 */
export function hashOrder(order: Order): string {
  return ethers.utils._TypedDataEncoder.hashStruct(
    "Order",
    { Order: ORDER_TYPE_FIELDS },
    {
      ...order,
      receiver: order.receiver ?? ethers.constants.AddressZero,
      validTo: timestamp(order.validTo),
    },
  );
}

/**
 * The byte length of an order UID.
 */
export const ORDER_UID_LENGTH = 56;

/**
 * Order unique identifier parameters.
 */
export interface OrderUidParams {
  /**
   * The EIP-712 order struct hash.
   */
  orderDigest: string;
  /**
   * The owner of the order.
   */
  owner: string;
  /**
   * The timestamp this order is valid until.
   */
  validTo: number | Date;
}

/**
 * Compute the unique identifier describing a user order in the settlement
 * contract.
 *
 * @param OrderUidParams The parameters used for computing the order's unique
 * identifier.
 * @returns A string that unequivocally identifies the order of the user.
 */
export function computeOrderUid({
  orderDigest,
  owner,
  validTo,
}: OrderUidParams): string {
  return ethers.utils.solidityPack(
    ["bytes32", "address", "uint32"],
    [orderDigest, owner, timestamp(validTo)],
  );
}

/**
 * Extracts the order unique identifier parameters from the specified bytes.
 *
 * @param orderUid The order UID encoded as a hexadecimal string.
 * @returns The extracted order UID parameters.
 */
export function extractOrderUidParams(orderUid: string): OrderUidParams {
  const bytes = ethers.utils.arrayify(orderUid);
  if (bytes.length != ORDER_UID_LENGTH) {
    throw new Error("invalid order UID length");
  }

  const view = new DataView(bytes.buffer);
  return {
    orderDigest: ethers.utils.hexlify(bytes.subarray(0, 32)),
    owner: ethers.utils.getAddress(
      ethers.utils.hexlify(bytes.subarray(32, 52)),
    ),
    validTo: view.getUint32(52),
  };
}
