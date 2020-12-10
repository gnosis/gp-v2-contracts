import { ethers, BigNumberish, Signer, TypedDataDomain } from "ethers";

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
export const enum OrderKind {
  /**
   * A sell order.
   */
  SELL,
  /**
   * A buy order.
   */
  BUY,
}

/**
 * The EIP-712 type fields definition for a Gnosis Protocol v2 order.
 */
export const ORDER_TYPE_FIELDS = [
  { name: "sellToken", type: "address" },
  { name: "buyToken", type: "address" },
  { name: "sellAmount", type: "uint256" },
  { name: "buyAmount", type: "uint256" },
  { name: "validTo", type: "uint32" },
  { name: "appData", type: "uint32" },
  { name: "feeAmount", type: "uint256" },
  { name: "kind", type: "uint8" },
  { name: "partiallyFillable", type: "bool" },
];

/**
 * The EIP-712 type hash for a Gnosis Protocol v2 order.
 */
export const ORDER_TYPE_HASH = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes(
    `Order(${ORDER_TYPE_FIELDS.map(({ name, type }) => `${type} ${name}`).join(
      ",",
    )})`,
  ),
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
    { ...order, validTo: timestamp(order.validTo) },
  );
}

/**
 * The signing scheme used to sign the order.
 */
export const enum SigningScheme {
  /**
   * The EIP-712 typed data signing scheme. This is the preferred scheme as it
   * provides more infomation to wallets performing the signature on the data
   * being signed.
   *
   * <https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md#definition-of-domainseparator>
   */
  TYPED_DATA,
  /**
   * The generic message signing scheme.
   */
  MESSAGE,
}

/**
 * Returns the signature for the specified order.
 * @param domain The domain to sign the order for. This is used by the smart
 * contract to ensure order's can't be replayed across different applications,
 * but also different deployments (as the contract chain ID and address are
 * mixed into to the domain value).
 * @param order The order to sign.
 * @param owner The owner for the order used to sign.
 * @param scheme The signing scheme to use. See {@link SigningScheme} for more
 * details.
 * @return Hex-encoded signature for the order.
 */
export function signOrder(
  domain: TypedDataDomain,
  order: Order,
  owner: Signer,
  scheme: SigningScheme,
): Promise<string> {
  switch (scheme) {
    case SigningScheme.TYPED_DATA:
      if (!owner._signTypedData) {
        throw new Error("signer does not support signing typed data");
      }
      return owner._signTypedData(
        domain,
        { Order: ORDER_TYPE_FIELDS },
        { ...order, validTo: timestamp(order.validTo) },
      );

    case SigningScheme.MESSAGE:
      return owner.signMessage(
        ethers.utils.arrayify(
          ethers.utils.hexConcat([
            ethers.utils._TypedDataEncoder.hashDomain(domain),
            hashOrder(order),
          ]),
        ),
      );
  }
}

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
  if (bytes.length != 56) {
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
