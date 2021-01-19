import { BigNumberish, BytesLike, Signer, ethers } from "ethers";

import { Interaction, encodeInteraction } from "./interaction";
import {
  ORDER_UID_LENGTH,
  Order,
  OrderFlags,
  OrderKind,
  SigningScheme,
  signOrder,
  timestamp,
} from "./order";
import { TypedDataDomain } from "./types/ethers";

/**
 * The stage an interaction should be executed in.
 */
export enum InteractionStage {
  /**
   * A pre-settlement intraction.
   *
   * The interaction will be executed before any trading occurs. This can be
   * used, for example, to perform as EIP-2612 `permit` call for a user trading
   * in the current settlement.
   */
  PRE = 0,
  /**
   * An intra-settlement interaction.
   *
   * The interaction will be executed after all trade sell amounts are
   * transferred into the settlement contract, but before the buy amounts are
   * transferred out to the traders. This can be used, for example, to interact
   * with on-chain AMMs.
   */
  INTRA = 1,
  /**
   * A post-settlement interaction.
   *
   * The interaction will be executed after all trading has completed.
   */
  POST = 2,
}

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

/**
 * Table mapping token addresses to their respective clearing prices.
 */
export type Prices = Record<string, BigNumberish | undefined>;

/**
 * Encoded settlement parameters.
 */
export type EncodedSettlement = [
  /** Tokens. */
  string[],
  /** Clearing prices. */
  BigNumberish[],
  /** Encoded trades. */
  BytesLike,
  /** Encoded interactions. */
  [BytesLike, BytesLike, BytesLike],
  /** Encoded order refunds. */
  BytesLike,
];

/**
 * Fee discount value used to indicate that all fees should be waived.
 */
export const FULL_FEE_DISCOUNT = 10000;

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
  private _encodedInteractions = {
    [InteractionStage.PRE]: "0x",
    [InteractionStage.INTRA]: "0x",
    [InteractionStage.POST]: "0x",
  };
  private _encodedOrderRefunds = "0x";

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
   * Gets the encoded interactions for the specified stage as a hex-encoded
   * string.
   */
  public get encodedInteractions(): [string, string, string] {
    return [
      this._encodedInteractions[InteractionStage.PRE],
      this._encodedInteractions[InteractionStage.INTRA],
      this._encodedInteractions[InteractionStage.POST],
    ];
  }

  /**
   * Gets the currently encoded order UIDs for gas refunds.
   */
  public get encodedOrderRefunds(): string {
    return this._encodedOrderRefunds;
  }

  /**
   * Gets the number of trades currently encoded.
   */
  public get tradeCount(): number {
    const TRADE_STRIDE = 206;
    return ethers.utils.hexDataLength(this._encodedTrades) / TRADE_STRIDE;
  }

  /**
   * Gets the number of order refunds currently encoded.
   */
  public get orderRefundCount(): number {
    return (
      ethers.utils.hexDataLength(this._encodedOrderRefunds) / ORDER_UID_LENGTH
    );
  }

  /**
   * Returns a clearing price vector for the current settlement tokens from the
   * provided price map.
   * @param prices The price map from token address to price.
   * @return The price vector.
   */
  public clearingPrices(prices: Prices): BigNumberish[] {
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
    signature: BytesLike,
    tradeExecution?: Partial<TradeExecution>,
  ): void {
    const { executedAmount, feeDiscount } = tradeExecution || {};
    if (order.partiallyFillable && executedAmount === undefined) {
      throw new Error("missing executed amount for partially fillable trade");
    }

    const SIGNATURE_LENGTH = 65;
    if (ethers.utils.hexDataLength(signature) !== SIGNATURE_LENGTH) {
      throw new Error("invalid signatuare bytes");
    }

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
        "bytes",
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
        signature,
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
    this.encodeTrade(order, signature, tradeExecution);
  }

  /**
   * Encodes the input interaction in the packed format accepted by the smart
   * contract and adds it to the interactions encoded so far.
   *
   * @param stage The stage the interaction should be executed.
   * @param interaction The interaction to encode.
   */
  public encodeInteraction(
    interaction: Interaction,
    stage: InteractionStage = InteractionStage.INTRA,
  ): void {
    this._encodedInteractions[stage] = ethers.utils.hexConcat([
      this._encodedInteractions[stage],
      encodeInteraction(interaction),
    ]);
  }

  /**
   * Encodes order UIDs for gas refunds.
   *
   * @param orderUids The order UIDs for which to claim gas refunds.
   */
  public encodeOrderRefunds(...orderUids: string[]): void {
    if (
      !orderUids.every((orderUid) =>
        ethers.utils.isHexString(orderUid, ORDER_UID_LENGTH),
      )
    ) {
      throw new Error("one or more invalid order UIDs");
    }

    this._encodedOrderRefunds = ethers.utils.hexConcat([
      this._encodedOrderRefunds,
      ...orderUids,
    ]);
  }

  /**
   * Returns the encoded settlement parameters.
   */
  public encodedSettlement(prices: Prices): EncodedSettlement {
    return [
      this.tokens,
      this.clearingPrices(prices),
      this.encodedTrades,
      this.encodedInteractions,
      this.encodedOrderRefunds,
    ];
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
