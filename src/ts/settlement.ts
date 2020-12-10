import {
  BigNumberish,
  SignatureLike,
  Signer,
  TypedDataDomain,
  ethers,
} from "ethers";

import {
  Order,
  OrderFlags,
  OrderKind,
  SigningScheme,
  signOrder,
  timestamp,
} from "./order";

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
        order.feeAmount,
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
