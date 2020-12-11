import { BigNumberish, Signer, ethers } from "ethers";

import {
  Order,
  OrderFlags,
  OrderKind,
  SigningScheme,
  signOrder,
  timestamp,
} from "./order";
import { TypedDataDomain, SignatureLike } from "./types/ethers";

/**
 * Details representing how an order was executed.
 */
export interface TradeExecution {
  /**
   * The executed trade amount.
   *
   * How this amount is used by the settlement contract depends on the order
   * flags:
   * - Partially fillable sell orders: the amount of sell tokens to trade.
   * - Partially fillable buy orders: the amount of buy tokens to trade.
   * - Fill-or-kill orders: this value is ignored.
   */
  executedAmount: BigNumberish;
  /**
   * Optional fee discount to use in basis points (1/100th of 1%).
   *
   * If this value is `0`, then there is no discount and the full fee will be
   * taken for the order. A value of `10000` is used to indicate a full
   * discount, meaning no fees will be taken.
   */
  feeDiscount: number;
}

import { Interaction } from ".";

function encodeOrderFlags(flags: OrderFlags): number {
  let kind;
  switch (flags.kind) {
    case OrderKind.SELL:
      kind = 0;
      break;
    case OrderKind.BUY:
      kind = 1;
      break;
    default:
      throw new Error(`invalid error kind '${kind}'`);
  }
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
  private _encodedInteractions = "0x";

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
   * Gets the encoded trades as a hex-encoded string.
   */
  public get encodedInteractions(): string {
    return this._encodedInteractions;
  }

  /**
   * Gets the number of trades currently encoded.
   */
  public get tradeCount(): number {
    const TRADE_STRIDE = 206;
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
   * @param signature The signature for the order data.
   * @param scheme The signing scheme to used to generate the specified
   * signature. See {@link SigningScheme} for more details.
   * @param tradeExecution The execution details for the trade.
   */
  public encodeTrade(
    order: Order,
    signature: SignatureLike,
    scheme: SigningScheme,
    tradeExecution?: Partial<TradeExecution>,
  ): void {
    const { executedAmount, feeDiscount } = tradeExecution || {};
    if (order.partiallyFillable && executedAmount === undefined) {
      throw new Error("missing executed amount for partially fillable trade");
    }

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
        "uint16",
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
        executedAmount || 0,
        feeDiscount || 0,
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
   * @param owner The owner for the order used to sign.
   * @param scheme The signing scheme to use. See {@link SigningScheme} for more
   * details.
   * @param tradeExecution The execution details for the trade.
   */
  public async signEncodeTrade(
    order: Order,
    owner: Signer,
    scheme: SigningScheme,
    tradeExecution?: Partial<TradeExecution>,
  ): Promise<void> {
    const signature = await signOrder(this.domain, order, owner, scheme);
    this.encodeTrade(order, signature, scheme, tradeExecution);
  }

  /**
   * Encodes the input interaction in the packed format accepted by the smart
   * contract and adds it to the interactions encoded so far.
   *
   * @param interaction The interaction to encode.
   */
  public encodeInteraction(interaction: Interaction): void {
    const callDataLength = ethers.utils.hexDataLength(interaction.callData);

    const encodedInteraction = ethers.utils.solidityPack(
      ["address", "uint24", "bytes"],
      [interaction.target, callDataLength, interaction.callData],
    );

    this._encodedInteractions = ethers.utils.hexConcat([
      this._encodedInteractions,
      encodedInteraction,
    ]);
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
