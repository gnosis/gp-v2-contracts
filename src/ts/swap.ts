import { BigNumberish, BytesLike, Signer } from "ethers";

import { Order } from "./order";
import { TokenRegistry, Trade, encodeTrade } from "./settlement";
import { EcdsaSigningScheme, Signature, signOrder } from "./sign";
import { TypedDataDomain } from "./types/ethers";

/**
 * A Balancer swap used for settling a single order against Balancer pools.
 */
export interface Swap {
  /**
   * The ID of the pool for the swap.
   */
  poolId: BytesLike;
  /**
   * The swap input token address.
   */
  tokenIn: string;
  /**
   * The swap output token address.
   */
  tokenOut: string;
  /**
   * The amount to swap. This will ether be a fixed input amount when swapping
   * a sell order, or a fixed output amount when swapping a buy order.
   */
  amount: BigNumberish;
  /**
   * Optional additional pool user data required for the swap.
   *
   * This additional user data is pool implementation specific, and allows pools
   * to extend the Vault pool interface.
   */
  userData?: BytesLike;
}

/**
 * An encoded Balancer swap request that can be used as input to the settlement
 * contract.
 */
export interface SwapRequest {
  /**
   * The ID of the pool for the swap.
   */
  poolId: BytesLike;
  /**
   * The index of the input token.
   *
   * Settlement swap calls encode tokens as an array, this number represents an
   * index into that array.
   */
  tokenInIndex: number;
  /**
   * The index of the output token.
   */
  tokenOutIndex: number;
  /**
   * The amount to swap.
   */
  amount: BigNumberish;
  /**
   * Additional pool user data required for the swap.
   */
  userData: BytesLike;
}

/**
 * Encoded swap parameters.
 */
export type EncodedSwap = [
  /** Swap requests. */
  SwapRequest[],
  /** Tokens. */
  string[],
  /** Encoded trade. */
  Trade,
];

/**
 * Encodes a swap as a {@link SwapRequest} to be used with the settlement
 * contract.
 */
export function encodeSwapRequest(
  tokens: TokenRegistry,
  swap: Swap,
): SwapRequest {
  return {
    poolId: swap.poolId,
    tokenInIndex: tokens.index(swap.tokenIn),
    tokenOutIndex: tokens.index(swap.tokenOut),
    amount: swap.amount,
    userData: swap.userData || "0x",
  };
}

/**
 * A class for building calldata for a swap.
 *
 * The encoder ensures that token addresses are kept track of and performs
 * necessary computation in order to map each token addresses to IDs to
 * properly encode swap requests and the trade.
 */
export class SwapEncoder {
  private readonly _tokens = new TokenRegistry();
  private readonly _swaps: SwapRequest[] = [];
  private _trade: Trade | undefined = undefined;

  /**
   * Creates a new settlement encoder instance.
   *
   * @param domain Domain used for signing orders. See {@link signOrder} for
   * more details.
   */
  public constructor(public readonly domain: TypedDataDomain) {}

  /**
   * Gets the array of token addresses used by the currently encoded swaps.
   */
  public get tokens(): string[] {
    // NOTE: Make sure to slice the original array, so it cannot be modified
    // outside of this class.
    return this._tokens.addresses;
  }

  /**
   * Gets the encoded swaps.
   */
  public get swaps(): SwapRequest[] {
    return this._swaps.slice();
  }

  /**
   * Gets the encoded trade.
   */
  public get trade(): Trade {
    if (this._trade === undefined) {
      throw new Error("trade not encoded");
    }
    return this._trade;
  }

  /**
   * Encodes the swap as a swap request and appends it to the swaps encoded so
   * far.
   *
   * @param swap The Balancer swap to encode.
   */
  public encodeSwapRequest(...swaps: Swap[]): void {
    this._swaps.push(
      ...swaps.map((swap) => encodeSwapRequest(this._tokens, swap)),
    );
  }

  /**
   * Encodes a trade from a signed order.
   *
   * Additionally, if the order references new tokens that the encoder has not
   * yet seen, they are added to the tokens array.
   *
   * @param order The order of the trade to encode.
   * @param signature The signature for the order data.
   */
  public encodeTrade(order: Order, signature: Signature): void {
    this._trade = encodeTrade(this._tokens, order, signature, {
      executedAmount: 0,
    });
  }

  /**
   * Signs an order and encodes a trade with that order.
   *
   * @param order The order to sign for the trade.
   * @param owner The externally owned account that should sign the order.
   * @param scheme The signing scheme to use. See {@link SigningScheme} for more
   * details.
   */
  public async signEncodeTrade(
    order: Order,
    owner: Signer,
    scheme: EcdsaSigningScheme,
  ): Promise<void> {
    const signature = await signOrder(this.domain, order, owner, scheme);
    this.encodeTrade(order, signature);
  }

  /**
   * Returns the encoded swap parameters for the current state of the encoder.
   *
   * This method with raise an exception if a trade has not been encoded.
   */
  public encodedSwap(): EncodedSwap {
    return [this.swaps, this.tokens, this.trade];
  }

  public static encodeSwap(
    swaps: Swap[],
    order: Order,
    signature: Signature,
  ): EncodedSwap;

  public static encodeSwap(
    domain: TypedDataDomain,
    swaps: Swap[],
    order: Order,
    owner: Signer,
    scheme: EcdsaSigningScheme,
  ): Promise<EncodedSwap>;

  /**
   * Utility method for encoding a direct swap between an order and Balancer
   * pools.
   *
   * This method functions identically to using a {@link SwapEncoder} and is
   * provided as a short-cut.
   */
  public static encodeSwap(
    ...args:
      | [Swap[], Order, Signature]
      | [TypedDataDomain, Swap[], Order, Signer, EcdsaSigningScheme]
  ): EncodedSwap | Promise<EncodedSwap> {
    const [domain, swaps, order, ...signatureOrSigner] =
      args.length === 3 ? [{ name: "unused" }, ...args] : args;

    const encoder = new SwapEncoder(domain);
    encoder.encodeSwapRequest(...swaps);

    if (signatureOrSigner.length === 1) {
      const [signature] = signatureOrSigner;
      encoder.encodeTrade(order, signature);
      return encoder.encodedSwap();
    } else {
      const [owner, scheme] = signatureOrSigner;
      return encoder
        .signEncodeTrade(order, owner, scheme)
        .then(() => encoder.encodedSwap());
    }
  }
}
