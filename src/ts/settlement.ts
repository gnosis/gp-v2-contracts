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
  OrderFlags,
  OrderKind,
  normalizeOrder,
  hashTypedData,
  ORDER_TYPE_FIELDS,
} from "./order";
import {
  EcdsaSigningScheme,
  Signature,
  SigningScheme,
  encodeEip1271SignatureData,
  signOrder,
  decodeEip1271SignatureData,
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
    "sellToken" | "buyToken" | "kind" | "partiallyFillable"
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
 * An object listing all flag options in order along with their bit offset.
 */
export const FLAG_MASKS = {
  kind: {
    offset: 0,
    options: [OrderKind.SELL, OrderKind.BUY],
  },
  partiallyFillable: {
    offset: 1,
    options: [false, true],
  },
  signingScheme: {
    offset: 2,
    options: [
      SigningScheme.EIP712,
      SigningScheme.ETHSIGN,
      SigningScheme.EIP1271,
      SigningScheme.PRESIGN,
    ],
  },
} as const;

export type FlagKey = keyof typeof FLAG_MASKS;
export type FlagOptions<K extends FlagKey> = typeof FLAG_MASKS[K]["options"];
export type FlagValue<K extends FlagKey> = FlagOptions<K>[number];

function encodeFlag<K extends FlagKey>(key: K, flag: FlagValue<K>): number {
  const index = FLAG_MASKS[key].options.findIndex(
    (search: unknown) => search === flag,
  );
  if (index === undefined) {
    throw new Error(`Bad key/value pair to encode: ${key}/${flag}`);
  }
  return index << FLAG_MASKS[key].offset;
}

// Counts the smallest mask needed to store the input options in the masked
// bitfield.
function mask(options: readonly unknown[]): number {
  const num = options.length;
  const bitCount = 32 - Math.clz32(num - 1);
  return (1 << bitCount) - 1;
}

function decodeFlag<K extends FlagKey>(key: K, flag: number): FlagValue<K> {
  const { offset, options } = FLAG_MASKS[key];
  const index = (flag >> offset) & mask(options);
  // This type casting should not be needed
  const decoded = options[index] as FlagValue<K>;
  if (decoded === undefined || index < 0) {
    throw new Error(`Invalid input flag for ${key}: 0b${flag.toString(2)}`);
  }
  return decoded;
}

/**
 * Encodes signing scheme as a bitfield.
 *
 * @param scheme The signing scheme to encode.
 * @return The bitfield result.
 */
export function encodeSigningScheme(scheme: SigningScheme): number {
  return encodeFlag("signingScheme", scheme);
}

/**
 * Decodes signing scheme from a bitfield.
 *
 * @param flag The encoded order flag.
 * @return The decoded signing scheme.
 */
export function decodeSigningScheme(flags: number): SigningScheme {
  return decodeFlag("signingScheme", flags);
}

/**
 * Encodes order flags as a bitfield.
 *
 * @param flags The order flags to encode.
 * @return The bitfield result.
 */
export function encodeOrderFlags(flags: OrderFlags): number {
  return (
    encodeFlag("kind", flags.kind) |
    encodeFlag("partiallyFillable", flags.partiallyFillable)
  );
}

/**
 * Decode order flags from a bitfield.
 *
 * @param flags The order flags encoded as a bitfield.
 * @return The decoded order flags.
 */
export function decodeOrderFlags(flags: number): OrderFlags {
  return {
    kind: decodeFlag("kind", flags),
    partiallyFillable: decodeFlag("partiallyFillable", flags),
  };
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

/**
 * Decode trade flags from a bitfield.
 *
 * @param flags The trade flags encoded as a bitfield.
 * @return The bitfield result.
 */
export function decodeTradeFlags(flags: number): TradeFlags {
  return {
    ...decodeOrderFlags(flags),
    signingScheme: decodeSigningScheme(flags),
  };
}

export function encodeSignatureData(sig: Signature): string {
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

export function decodeSignatureOwner(
  domain: TypedDataDomain,
  order: Order,
  scheme: SigningScheme,
  sig: BytesLike,
): string {
  switch (scheme) {
    case SigningScheme.EIP712:
      return ethers.utils.verifyTypedData(
        domain,
        { Order: ORDER_TYPE_FIELDS },
        normalizeOrder(order),
        sig,
      );
    case SigningScheme.ETHSIGN:
      return ethers.utils.verifyMessage(
        ethers.utils.arrayify(
          hashTypedData(
            domain,
            { Order: ORDER_TYPE_FIELDS },
            normalizeOrder(order),
          ),
        ),
        sig,
      );
    case SigningScheme.EIP1271:
      return decodeEip1271SignatureData(sig).verifier;
    case SigningScheme.PRESIGN:
      return ethers.utils.getAddress(ethers.utils.hexlify(sig));
    default:
      throw new Error("unsupported signing scheme");
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
  private _trades: Trade[] = [];
  private _interactions: Record<InteractionStage, Interaction[]> = {
    [InteractionStage.PRE]: [],
    [InteractionStage.INTRA]: [],
    [InteractionStage.POST]: [],
  };
  private _orderRefunds: OrderRefunds = {
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
    tradeExecution?: Partial<TradeExecution>,
  ): void {
    const { executedAmount } = tradeExecution || {};
    if (order.partiallyFillable && executedAmount === undefined) {
      throw new Error("missing executed amount for partially fillable trade");
    }

    if (order.receiver === ethers.constants.AddressZero) {
      throw new Error("receiver cannot be address(0)");
    }

    const tradeFlags = {
      ...order,
      signingScheme: signature.scheme,
    };
    const o = normalizeOrder(order);

    this._trades.push({
      sellTokenIndex: this.tokenIndex(o.sellToken),
      buyTokenIndex: this.tokenIndex(o.buyToken),
      receiver: o.receiver,
      sellAmount: o.sellAmount,
      buyAmount: o.buyAmount,
      validTo: o.validTo,
      appData: o.appData,
      feeAmount: o.feeAmount,
      flags: encodeTradeFlags(tradeFlags),
      executedAmount: executedAmount || 0,
      signature: encodeSignatureData(signature),
    });
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
 * Decodes an order from a settlement trade.
 *
 * @param trade The trade to decode into an order.
 * @param tokens The list of token addresses as they appear in the settlement.
 * @returns The decoded order.
 */
export function decodeOrder(trade: Trade, tokens: string[]): Order {
  if (Math.max(trade.sellTokenIndex, trade.buyTokenIndex) >= tokens.length) {
    throw new Error("Invalid trade");
  }
  return {
    sellToken: tokens[trade.sellTokenIndex],
    buyToken: tokens[trade.buyTokenIndex],
    receiver: trade.receiver,
    sellAmount: trade.sellAmount,
    buyAmount: trade.buyAmount,
    validTo: trade.validTo,
    appData: trade.appData,
    feeAmount: trade.feeAmount,
    ...decodeOrderFlags(trade.flags),
  };
}
