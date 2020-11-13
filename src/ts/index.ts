import { ethers, BigNumberish, Signature, SignatureLike, Wallet } from "ethers";

/**
 * EIP-712 domain data used by GPv2.
 *
 * Note, that EIP-712 allows for an extra `salt` to be added to the domain that
 * isn't used.
 * <https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md#definition-of-domainseparator>
 */
export interface EIP712Domain {
  /**
   * The user readable name of signing domain.
   */
  name: string;
  /**
   * The current major version of the signing domain.
   */
  version: string;
  /**
   * The EIP-155 chain ID.
   */
  chainId: number;
  /**
   * The address of the contract that will verify the EIP-712 signature.
   */
  verifyingContract: string;
}

/**
 * Return the Gnosis Protocol v2 domain used for signing.
 * @param chainId The EIP-155 chain ID.
 * @param verifyingContract The address of the contract that will verify the
 * signature.
 * @return An EIP-712 compatible typed domain data.
 */
export function domain(
  chainId: number,
  verifyingContract: string,
): EIP712Domain {
  return {
    name: "Gnosis Protocol",
    version: "v2",
    chainId,
    verifyingContract,
  };
}

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
  validTo: number | Date;
  /**
   * A nonce to ensure orders aren't replayable.
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
 * Reserved nonce value used to indicate that an order can be replayed in any
 * batch.
 */
export const REPLAYABLE_NONCE = 0;

const ORDER_STRIDE = 204;

function timestamp(time: number | Date): number {
  return typeof time === "number" ? time : ~~(time.getTime() / 1000);
}

function encodeOrderFlags(flags: OrderFlags): number {
  const kind = flags.kind === OrderKind.SELL ? 0x00 : 0x01;
  const partiallyFillable = flags.partiallyFillable ? 0x02 : 0x00;
  return kind | partiallyFillable;
}

/**
 * A class for building a buffer of encoded orders.
 *
 * The encoder ensures that token addresses are kept track of and performs
 * necessary computation in order to map each token addresses to IDs.
 */
export class OrderEncoder {
  private readonly _tokens: string[] = [];
  private readonly _tokenMap: Record<string, number | undefined> = {};
  private _encodedOrders = "0x";

  /**
   * Creates a new order encoder instance.
   * @param domainSeparator Domain separator used for signing orders to encode.
   * See {@link hashOrder} for more details.
   */
  public constructor(public readonly domainSeparator: string) {}

  /**
   * Gets the array of token addresses used by the currently encoded orders.
   *
   * This is used as encoded orders reference tokens by index instead of
   * directly by address for multiple reasons:
   * - Reduce encoding size of orders to save on `calldata` gas.
   * - Direct access to a token's clearing price on settlement instead of
   *   requiring a search.
   */
  public get tokens(): string[] {
    // NOTE: Make sure to slice the original array, so it cannot be modified
    // outside of this class.
    return this._tokens.slice();
  }

  /**
   * Gets the encoded orders as a hex-encoded string.
   */
  public get encodedOrders(): string {
    return this._encodedOrders;
  }

  /**
   * Gets the number of orders currently encoded.
   */
  public get orderCount(): number {
    // NOTE: `ORDER_STRIDE` multiplied by 2 as hex strings encode one byte in
    // 2 characters.
    return (this._encodedOrders.length - 2) / (ORDER_STRIDE * 2);
  }

  /**
   * Encodes a signed order, appending it to the `calldata` bytes that are being
   * built.
   *
   * Additionally, if the order references new tokens that the encoder has not
   * yet seen, they are added to the tokens array.
   * @param order The order to encode.
   * @param executedAmount The executed trade amount for the order.
   * @param signature The signature for the order data.
   */
  public encodeOrder(
    order: Order,
    executedAmount: BigNumberish,
    signature: SignatureLike,
  ): void {
    const sig = ethers.utils.splitSignature(signature);
    const encodedOrder = ethers.utils.solidityPack(
      [
        "uint8",
        "uint8",
        "uint256",
        "uint256",
        "uint32",
        "uint32",
        "uint256",
        "uint8",
        "uint256",
        "uint8",
        "bytes32",
        "bytes32",
      ],
      [
        this.tokenIndex(order.sellToken),
        this.tokenIndex(order.buyToken),
        order.sellAmount,
        order.buyAmount,
        timestamp(order.validTo),
        order.nonce,
        order.tip,
        encodeOrderFlags(order),
        executedAmount,
        sig.v,
        sig.r,
        sig.s,
      ],
    );

    this._encodedOrders = `${this._encodedOrders}${encodedOrder.substr(2)}`;
  }

  /**
   * Signs and encodes an order.
   * @param owner The owner for the order used to sign.
   * @param order The order to compute the digest for.
   * @param executedAmount The executed trade amount for the order.
   * @return Signature for the order.
   */
  public signEncodeOrder(
    owner: Wallet,
    order: Order,
    executedAmount: BigNumberish,
  ): void {
    if (!this.domainSeparator) {
      throw new Error("domain separator not specified");
    }
    const signature = signOrder(owner, this.domainSeparator, order);
    this.encodeOrder(order, executedAmount, signature);
  }

  private tokenIndex(token: string): number {
    // NOTE: Verify and normalize the address into a case-checksummed address.
    // Not only does this ensure validity of the addresses early on, it also
    // makes it so `0xff...f` and `0xFF..F` map to the same ID.
    const tokenAddress = ethers.utils.getAddress(token);

    let tokenIndex = this._tokenMap[tokenAddress];
    if (tokenIndex === undefined) {
      tokenIndex = this._tokens.length;
      this._tokens.push(tokenAddress);
      this._tokenMap[tokenAddress] = tokenIndex;
    }

    return tokenIndex;
  }
}

/**
 * Compute the 32-byte digest for the specified order.
 * @param domainSeparator The domain separator to add to the digest. This is
 * used by the smart contract to ensure order's can't be replayed across
 * different applications (domains), but also different deployments (as the
 * contract chain ID and address is used to salt the domain separator value).
 * @param order The order to compute the digest for.
 * @return Hex-encoded 32-byte order digest.
 */
export function hashOrder(domainSeparator: string, order: Order): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      [
        "bytes32",
        "address",
        "address",
        "uint256",
        "uint256",
        "uint32",
        "uint32",
        "uint256",
        "uint8",
        "bool",
      ],
      [
        domainSeparator,
        order.sellToken,
        order.buyToken,
        order.sellAmount,
        order.buyAmount,
        order.validTo,
        order.nonce,
        order.tip,
        order.kind,
        order.partiallyFillable,
      ],
    ),
  );
}

/**
 * Returns the signature for the specified order.
 * @param owner The owner for the order used to sign.
 * @param domainSeparator The domain separator to add to the digest used for
 * signing. See {@link hashOrder} for more details.
 * @param order The order to sign.
 * @return Signature for the order.
 */
export function signOrder(
  owner: Wallet,
  domainSeparator: string,
  order: Order,
): Signature {
  const digest = hashOrder(domainSeparator, order);
  // NOTE: We need to sign directly with the signing key here on an Ethers.js
  // wallet and not the `Signer` API, as the latter uses the `"\x19Ethereum
  // Signed Message:\n" + len(message)` prefix. This is likely to change in the
  // future as wallets generally don't provide a method for doing this as it is
  // considered unsafe.
  // <https://github.com/gnosis/oba-contracts/issues/129>
  return owner._signingKey().signDigest(digest);
}
