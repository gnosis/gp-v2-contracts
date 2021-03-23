import { BigNumberish, BytesLike, Signer, ethers } from "ethers";

import {
  Interaction,
  InteractionLike,
  normalizeInteraction,
} from "./interaction";
import {
  NormalizedOrder,
  ORDER_UID_LENGTH,
  Order,
  OrderBalance,
  OrderFlags,
  OrderKind,
  normalizeOrder,
} from "./order";
import {
  EcdsaSigningScheme,
  Signature,
  SigningScheme,
  encodeEip1271SignatureData,
  signOrder,
} from "./sign";
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
 * Gnosis Protocol v2 trade flags.
 */
export interface TradeFlags extends OrderFlags {
  /**
   * The signing scheme used to encode the signature.
   */
  signingScheme: SigningScheme;
}

/**
 * Trade parameters used in a settlement.
 */
export type Trade = TradeExecution &
  Omit<
    NormalizedOrder,
    | "sellToken"
    | "buyToken"
    | "kind"
    | "partiallyFillable"
    | "sellTokenBalance"
    | "buyTokenBalance"
  > & {
    /**
     * The index of the sell token in the settlement.
     */
    sellTokenIndex: number;
    /**
     * The index of the buy token in the settlement.
     */
    buyTokenIndex: number;
    /**
     * Encoded order flags.
     */
    flags: number;
    /**
     * Signature data.
     */
    signature: BytesLike;
  };

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
}

/**
 * Order refund data.
 */
export interface OrderRefunds {
  /** Refund storage used for order filled amount */
  filledAmounts: BytesLike[];
  /** Refund storage used for order pre-signature */
  preSignatures: BytesLike[];
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
  Trade[],
  /** Encoded interactions. */
  [Interaction[], Interaction[], Interaction[]],
];

/**
 * Encodes signing scheme as a bitfield.
 *
 * @param scheme The signing scheme to encode.
 * @return The bitfield result.
 */
export function encodeSigningScheme(scheme: SigningScheme): number {
  const SIGNING_SCHEME_BIT_OFFSET = 5;
  switch (scheme) {
    case SigningScheme.EIP712:
    case SigningScheme.ETHSIGN:
    case SigningScheme.EIP1271:
    case SigningScheme.PRESIGN:
      return scheme << SIGNING_SCHEME_BIT_OFFSET;
    default:
      throw new Error("Unsupported signing scheme");
  }
}

/**
 * Encodes order flags as a bitfield.
 *
 * @param flags The order flags to encode.
 * @return The bitfield result.
 */
export function encodeOrderFlags(flags: OrderFlags): number {
  let kind;
  switch (flags.kind) {
    case OrderKind.SELL:
      kind = 0b00000;
      break;
    case OrderKind.BUY:
      kind = 0b00001;
      break;
    default:
      throw new Error(`invalid order kind '${flags.kind}'`);
  }
  const partiallyFillable = flags.partiallyFillable ? 0b0010 : 0b0000;
  let sellTokenBalance;
  switch (flags.sellTokenBalance) {
    case undefined:
    case OrderBalance.ERC20:
      sellTokenBalance = 0b00000;
      break;
    case OrderBalance.EXTERNAL:
      sellTokenBalance = 0b01000;
      break;
    case OrderBalance.INTERNAL:
      sellTokenBalance = 0b01100;
      break;
    default:
      throw new Error(`invalid balance flag '${flags.sellTokenBalance}'`);
  }
  let buyTokenBalance;
  switch (flags.buyTokenBalance) {
    case undefined:
    case OrderBalance.EXTERNAL:
    case OrderBalance.ERC20:
      buyTokenBalance = 0b00000;
      break;
    case OrderBalance.INTERNAL:
      buyTokenBalance = 0b10000;
      break;
    default:
      throw new Error(`invalid balance flag '${flags.buyTokenBalance}'`);
  }

  return kind | partiallyFillable | sellTokenBalance | buyTokenBalance;
}

/**
 * Encodes trade flags as a bitfield.
 *
 * @param flags The trade flags to encode.
 * @return The bitfield result.
 */
export function encodeTradeFlags(flags: TradeFlags): number {
  return encodeOrderFlags(flags) | encodeSigningScheme(flags.signingScheme);
}

function encodeSignatureData(sig: Signature): string {
  switch (sig.scheme) {
    case SigningScheme.EIP712:
    case SigningScheme.ETHSIGN:
      return ethers.utils.joinSignature(sig.data);
    case SigningScheme.EIP1271:
      return encodeEip1271SignatureData(sig.data);
    case SigningScheme.PRESIGN:
      return ethers.utils.getAddress(sig.data);
    default:
      throw new Error("unsupported signing scheme");
  }
}

/**
 * Encodes a trade to be used with the settlement contract.
 */
export function encodeTrade(
  tokens: TokenRegistry,
  order: Order,
  signature: Signature,
  { executedAmount }: TradeExecution,
): Trade {
  const tradeFlags = {
    ...order,
    signingScheme: signature.scheme,
  };
  const o = normalizeOrder(order);

  return {
    sellTokenIndex: tokens.index(o.sellToken),
    buyTokenIndex: tokens.index(o.buyToken),
    receiver: o.receiver,
    sellAmount: o.sellAmount,
    buyAmount: o.buyAmount,
    validTo: o.validTo,
    appData: o.appData,
    feeAmount: o.feeAmount,
    flags: encodeTradeFlags(tradeFlags),
    executedAmount,
    signature: encodeSignatureData(signature),
  };
}

/**
 * A class used for tracking tokens when encoding settlements.
 *
 * This is used as settlement trades reference tokens by index instead of
 * directly by address for multiple reasons:
 * - Reduce encoding size of orders to save on `calldata` gas.
 * - Direct access to a token's clearing price on settlement instead of
 *   requiring a search.
 */
export class TokenRegistry {
  private readonly _tokens: string[] = [];
  private readonly _tokenMap: Record<string, number | undefined> = {};

  /**
   * Gets the array of token addresses currently stored in the registry.
   */
  public get addresses(): string[] {
    // NOTE: Make sure to slice the original array, so it cannot be modified
    // outside of this class.
    return this._tokens.slice();
  }

  /**
   * Retrieves the token index for the specified token address. If the token is
   * not in the registry, it will be added.
   *
   * @param token The token address to add to the registry.
   * @return The token index.
   */
  public index(token: string): number {
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
 * A class for building calldata for a settlement.
 *
 * The encoder ensures that token addresses are kept track of and performs
 * necessary computation in order to map each token addresses to IDs to
 * properly encode order parameters for trades.
 */
export class SettlementEncoder {
  private readonly _tokens = new TokenRegistry();
  private readonly _trades: Trade[] = [];
  private readonly _interactions: Record<InteractionStage, Interaction[]> = {
    [InteractionStage.PRE]: [],
    [InteractionStage.INTRA]: [],
    [InteractionStage.POST]: [],
  };
  private readonly _orderRefunds: OrderRefunds = {
    filledAmounts: [],
    preSignatures: [],
  };

  /**
   * Creates a new settlement encoder instance.
   * @param domain Domain used for signing orders. See {@link signOrder} for
   * more details.
   */
  public constructor(public readonly domain: TypedDataDomain) {}

  /**
   * Gets the array of token addresses used by the currently encoded orders.
   */
  public get tokens(): string[] {
    // NOTE: Make sure to slice the original array, so it cannot be modified
    // outside of this class.
    return this._tokens.addresses;
  }

  /**
   * Gets the encoded trades.
   */
  public get trades(): Trade[] {
    return this._trades.slice();
  }

  /**
   * Gets all encoded interactions for all stages.
   *
   * Note that order refund interactions are included as post-interactions.
   */
  public get interactions(): [Interaction[], Interaction[], Interaction[]] {
    return [
      this._interactions[InteractionStage.PRE].slice(),
      this._interactions[InteractionStage.INTRA].slice(),
      [
        ...this._interactions[InteractionStage.POST],
        ...this.encodedOrderRefunds,
      ],
    ];
  }

  /**
   * Gets the order refunds encoded as interactions.
   */
  public get encodedOrderRefunds(): Interaction[] {
    const { filledAmounts, preSignatures } = this._orderRefunds;
    if (filledAmounts.length + preSignatures.length === 0) {
      return [];
    }

    const settlement = this.domain.verifyingContract;
    if (settlement === undefined) {
      throw new Error("domain missing settlement contract address");
    }

    // NOTE: Avoid importing the full GPv2Settlement contract artifact just for
    // a tiny snippet of the ABI. Unit and integration tests will catch any
    // issues that may arise from this definition becoming out of date.
    const iface = new ethers.utils.Interface([
      "function freeFilledAmountStorage(bytes[] orderUids)",
      "function freePreSignatureStorage(bytes[] orderUids)",
    ]);

    const interactions = [];
    for (const [functionName, orderUids] of [
      ["freeFilledAmountStorage", filledAmounts] as const,
      ["freePreSignatureStorage", preSignatures] as const,
    ].filter(([, orderUids]) => orderUids.length > 0)) {
      interactions.push(
        normalizeInteraction({
          target: settlement,
          callData: iface.encodeFunctionData(functionName, [orderUids]),
        }),
      );
    }

    return interactions;
  }

  /**
   * Returns a clearing price vector for the current settlement tokens from the
   * provided price map.
   *
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
   *
   * @param order The order of the trade to encode.
   * @param signature The signature for the order data.
   * @param tradeExecution The execution details for the trade.
   */
  public encodeTrade(
    order: Order,
    signature: Signature,
    { executedAmount }: Partial<TradeExecution> = {},
  ): void {
    if (order.partiallyFillable && executedAmount === undefined) {
      throw new Error("missing executed amount for partially fillable trade");
    }

    this._trades.push(
      encodeTrade(this._tokens, order, signature, {
        executedAmount: executedAmount ?? 0,
      }),
    );
  }

  /**
   * Signs an order and encodes a trade with that order.
   *
   * @param order The order to sign for the trade.
   * @param owner The externally owned account that should sign the order.
   * @param scheme The signing scheme to use. See {@link SigningScheme} for more
   * details.
   * @param tradeExecution The execution details for the trade.
   */
  public async signEncodeTrade(
    order: Order,
    owner: Signer,
    scheme: EcdsaSigningScheme,
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
    interaction: InteractionLike,
    stage: InteractionStage = InteractionStage.INTRA,
  ): void {
    this._interactions[stage].push(normalizeInteraction(interaction));
  }

  /**
   * Encodes order UIDs for gas refunds.
   *
   * @param settlement The address of the settlement contract.
   * @param orderRefunds The order refunds to encode.
   */
  public encodeOrderRefunds(orderRefunds: Partial<OrderRefunds>): void {
    if (this.domain.verifyingContract === undefined) {
      throw new Error("domain missing settlement contract address");
    }

    const filledAmounts = orderRefunds.filledAmounts ?? [];
    const preSignatures = orderRefunds.preSignatures ?? [];

    if (
      ![...filledAmounts, ...preSignatures].every((orderUid) =>
        ethers.utils.isHexString(orderUid, ORDER_UID_LENGTH),
      )
    ) {
      throw new Error("one or more invalid order UIDs");
    }

    this._orderRefunds.filledAmounts.push(...filledAmounts);
    this._orderRefunds.preSignatures.push(...preSignatures);
  }

  /**
   * Returns the encoded settlement parameters.
   */
  public encodedSettlement(prices: Prices): EncodedSettlement {
    return [
      this.tokens,
      this.clearingPrices(prices),
      this.trades,
      this.interactions,
    ];
  }

  /**
   * Returns an encoded settlement that exclusively performs setup interactions.
   * This method can be used, for example, to set the settlement contract's
   * allowances to other protocols it may interact with.
   *
   * @param interactions The list of setup interactions to encode.
   */
  public static encodedSetup(
    ...interactions: InteractionLike[]
  ): EncodedSettlement {
    const encoder = new SettlementEncoder({ name: "unused" });
    for (const interaction of interactions) {
      encoder.encodeInteraction(interaction);
    }
    return encoder.encodedSettlement({});
  }
}
