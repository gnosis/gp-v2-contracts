import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import { BigNumber, BigNumberish, Contract, providers, Signer } from "ethers";

import GPv2Settlement from "../../build/artifacts/src/contracts/GPv2Settlement.sol/GPv2Settlement.json";
import { domain } from "../../src/ts";
import { Order, OrderKind, SigningScheme } from "../../src/ts/order";
import { SettlementEncoder } from "../../src/ts/settlement";
import type { SignatureLike, TypedDataDomain } from "../../src/ts/types/ethers";

export interface UniswapTradeRequest {
  sellToken: string;
  buyToken: string;
  sellAmount: BigNumberish;
}

export interface UniswapPairState {
  uniswapPair: Contract;
  sellToken: Contract;
  reserveSellToken: BigNumber;
  buyToken: Contract;
  reserveBuyToken: BigNumber;
  isSellTokenToken0: boolean;
}

async function getUniswapState(
  uniswapFactory: Contract,
  { sellToken, buyToken }: { sellToken: string; buyToken: string },
  provider: providers.JsonRpcProvider,
): Promise<UniswapPairState> {
  const uniswapPair = new Contract(
    await uniswapFactory.getPair(sellToken, buyToken),
    UniswapV2Pair.abi,
    provider,
  );
  const sellTokenContract = new Contract(sellToken, ERC20.abi, provider);
  const buyTokenContract = new Contract(buyToken, ERC20.abi, provider);

  const [reserveSellToken, reserveBuyToken, pairToken0] = await Promise.all([
    sellTokenContract.balanceOf(uniswapPair.address),
    buyTokenContract.balanceOf(uniswapPair.address),
    uniswapPair.token0(),
  ]);

  const isSellTokenToken0 = sellToken === pairToken0;
  console.log(isSellTokenToken0);
  return {
    uniswapPair,
    reserveSellToken,
    reserveBuyToken,
    sellToken: sellTokenContract,
    buyToken: buyTokenContract,
    isSellTokenToken0,
  };
}

/**
 * A very basic solver that takes the amount a user wishes to trade on Uniswap
 * and uses it to:
 * 1. transform the swap into a GPv2 sell order to sign;
 * 2. given the signed order, settle the trade onchain.
 *
 * This class is single use: each new Uniswap order requires a new instance of
 * this class.
 */
export class UniswapMatch {
  private readonly uniswapFactory: Contract;
  private readonly settlement: Contract;
  private readonly domainSeparator: Promise<TypedDataDomain>;
  private readonly provider: providers.JsonRpcProvider;
  order?: Order;
  uniswapState?: UniswapPairState;

  constructor({
    uniswapFactoryAddress,
    settlementAddress,
    provider,
  }: {
    uniswapFactoryAddress: string;
    settlementAddress: string;
    provider: providers.JsonRpcProvider;
  }) {
    this.uniswapFactory = new Contract(
      uniswapFactoryAddress,
      UniswapV2Factory.abi,
      provider,
    );
    this.settlement = new Contract(
      settlementAddress,
      GPv2Settlement.abi,
      provider,
    );
    this.provider = provider;
    this.domainSeparator = provider
      .getNetwork()
      .then(({ chainId }) => domain(chainId, this.settlement.address));
  }

  async createSellOrder({
    sellToken,
    buyToken,
    sellAmount,
  }: UniswapTradeRequest): Promise<Order> {
    sellAmount = BigNumber.from(sellAmount);

    const uniswapState = await getUniswapState(
      this.uniswapFactory,
      {
        sellToken,
        buyToken,
      },
      this.provider,
    );

    const buyAmount = uniswapState.reserveBuyToken
      .mul(sellAmount)
      .mul(997)
      .div(uniswapState.reserveSellToken.mul(1000).add(sellAmount.mul(997)));

    this.uniswapState = uniswapState;

    this.order = {
      kind: OrderKind.BUY,
      partiallyFillable: false,
      buyToken,
      sellToken,
      buyAmount,
      sellAmount,
      feeAmount: 0,
      validTo: 0xffffffff,
      appData: 0,
    };

    return this.order;
  }

  async submitSolution(
    signature: SignatureLike,
    scheme: SigningScheme,
    solver: Signer,
  ): Promise<void> {
    const encoder = new SettlementEncoder(await this.domainSeparator);

    if (this.order === undefined || this.uniswapState === undefined) {
      throw new Error(
        "Uniswap order must be created before submitting a solution.",
      );
    }
    const {
      uniswapPair,
      isSellTokenToken0,
      sellToken,
      buyToken,
    } = this.uniswapState;

    encoder.encodeTrade(this.order, signature, scheme);

    encoder.encodeInteraction({
      target: sellToken.address,
      callData: sellToken.interface.encodeFunctionData("transfer", [
        uniswapPair.address,
        this.order.sellAmount,
      ]),
    });

    const [amount0Out, amount1Out] = isSellTokenToken0
      ? [0, this.order.buyAmount]
      : [this.order.buyAmount, 0];
    encoder.encodeInteraction({
      target: this.uniswapState.uniswapPair.address,
      callData: uniswapPair.interface.encodeFunctionData("swap", [
        amount0Out,
        amount1Out,
        this.settlement.address,
        "0x",
      ]),
    });

    await this.settlement.connect(solver).settle(
      encoder.tokens,
      encoder.clearingPrices({
        // Sell and buy tokens are swapped. This is a consequence of how prices
        // are defined on the settlement contract: for example, the sell token
        // price means that you can get this.order.buyAmount units in exchange
        // for a "theoretical" quote token. This means that in exchange for one
        // sell token wei, the batch trades this.order.buyAmount /
        // this.order.sellAmount buy token wei. That is, this.order.sellAmount
        // wei of buy token are exchanged for this.order.sellAmount sell
        // token wei.
        [sellToken.address]: this.order.buyAmount,
        [buyToken.address]: this.order.sellAmount,
      }),
      encoder.encodedTrades,
      encoder.encodedInteractions,
      "0x",
    );
  }
}
