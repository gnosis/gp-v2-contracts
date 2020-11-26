import {
  ethers,
  BigNumberish,
  SignatureLike,
  Signer,
  TypedDataDomain,
} from "ethers";

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
): TypedDataDomain {
  return {
    name: "Gnosis Protocol",
    version: "v2",
    chainId,
    verifyingContract,
  };
}

/**
 * Computes the address of the allowance manager contract for the specified
 * settlement contract address.
 * @param settlementAddress The address of the settlement contract.
 * @return The address of the allowance manager contract.
 */
export function allowanceManagerAddress(settlementAddress: string): string {
  // NOTE: `CREATE` opcode deploys a contract to a deterministic address based
  // on the calling contract address and the nonce, which for the settlement
  // contract is always 1 (as per EIP-161).
  const ADDRESS_STRING_OFFSET = 2 /* 0x */ + 2 * (32 - 20);
  return ethers.utils.getAddress(
    `0x${ethers.utils
      .keccak256(ethers.utils.RLP.encode([settlementAddress, "0x01"]))
      .substr(ADDRESS_STRING_OFFSET)}`,
  );
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
   * Arbitrary application specific data that can be added to an order. This can
   * also be used to ensure uniqueness between two orders with otherwise the
   * exact same parameters.
   */
  appData: number;
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
 * The EIP-712 type fields definition for a Gnosis Protocol v2 order.
 */
export const ORDER_TYPE_FIELDS = [
  { name: "sellToken", type: "address" },
  { name: "buyToken", type: "address" },
  { name: "sellAmount", type: "uint256" },
  { name: "buyAmount", type: "uint256" },
  { name: "validTo", type: "uint32" },
  { name: "appData", type: "uint32" },
  { name: "tip", type: "uint256" },
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

function timestamp(time: number | Date): number {
  return typeof time === "number" ? time : ~~(time.getTime() / 1000);
}

function encodeOrderFlags(flags: OrderFlags): number {
  const kind = flags.kind === OrderKind.SELL ? 0x00 : 0x01;
  const partiallyFillable = flags.partiallyFillable ? 0x02 : 0x00;
  return kind | partiallyFillable;
}

function encodeSigningScheme(v: number, scheme: SigningScheme): number {
  const ORDER_MESSAGE_SCHEME_FLAG = 0x80;
  switch (scheme) {
    case SigningScheme.TYPED_DATA:
      return v;
    case SigningScheme.MESSAGE:
      return v | ORDER_MESSAGE_SCHEME_FLAG;
  }
}

/**
 * A class for building calldata for a settlement.
 *
 * The encoder ensures that token addresses are kept track of and performs
 * necessary computation in order to map each token addresses to IDs to
 * properly encode order parameters for trades.
 */
export class SettlementEncoder {
  private readonly _tokens: string[] = [];
  private readonly _tokenMap: Record<string, number | undefined> = {};
  private _encodedTrades = "0x";

  /**
   * Creates a new settlement encoder instance.
   * @param domain Domain used for signing orders. See {@link signOrder} for
   * more details.
   */
  public constructor(public readonly domain: TypedDataDomain) {}

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
   * Gets the encoded trades as a hex-encoded string.
   */
  public get encodedTrades(): string {
    return this._encodedTrades;
  }

  /**
   * Gets the number of trades currently encoded.
   */
  public get tradeCount(): number {
    const TRADE_STRIDE = 204;
    // NOTE: `TRADE_STRIDE` multiplied by 2 as hex strings encode one byte in
    // 2 characters.
    return (this._encodedTrades.length - 2) / (TRADE_STRIDE * 2);
  }

  /**
   * Returns a clearing price vector for the current settlement tokens from the
   * provided price map.
   * @param prices The price map from token address to price.
   * @return The price vector.
   */
  public clearingPrices(
    prices: Record<string, BigNumberish | undefined>,
  ): BigNumberish[] {
    return this.tokens.map((token) => {
      const price = prices[token];
      if (price === undefined) {
        throw new Error(`missing price for token ${token}`);
      }
      return price;
    });
  }

  /**
   * Encodes a trade from a signed order and executed amount, appending it to
   * the `calldata` bytes that are being built.
   *
   * Additionally, if the order references new tokens that the encoder has not
   * yet seen, they are added to the tokens array.
   * @param order The order of the trade to encode.
   * @param executedAmount The executed trade amount.
   * @param signature The signature for the order data.
   * @param scheme The signing scheme to used to generate the specified
   * signature. See {@link SigningScheme} for more details.
   */
  public encodeTrade(
    order: Order,
    executedAmount: BigNumberish,
    signature: SignatureLike,
    scheme: SigningScheme,
  ): void {
    const sig = ethers.utils.splitSignature(signature);
    const encodedTrade = ethers.utils.solidityPack(
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
        order.appData,
        order.tip,
        encodeOrderFlags(order),
        executedAmount,
        encodeSigningScheme(sig.v, scheme),
        sig.r,
        sig.s,
      ],
    );

    this._encodedTrades = ethers.utils.hexConcat([
      this._encodedTrades,
      encodedTrade,
    ]);
  }

  /**
   * Signs an order and encodes a trade with that order.
   * @param order The order to sign for the trade.
   * @param executedAmount The executed trade amount for the order.
   * @param owner The owner for the order used to sign.
   * @param scheme The signing scheme to use. See {@link SigningScheme} for more
   * details.
   */
  public async signEncodeTrade(
    order: Order,
    executedAmount: BigNumberish,
    owner: Signer,
    scheme: SigningScheme,
  ): Promise<void> {
    const signature = await signOrder(this.domain, order, owner, scheme);
    this.encodeTrade(order, executedAmount, signature, scheme);
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
 * @param order The order to compute the digest for.
 * @return Hex-encoded 32-byte order digest.
 */
export function hashOrder(order: Order): string {
  return ethers.utils._TypedDataEncoder.hashStruct(
    "Order",
    { Order: ORDER_TYPE_FIELDS },
    order,
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
      return owner._signTypedData(domain, { Order: ORDER_TYPE_FIELDS }, order);

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
