import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import UniswapV2Router from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import Debug from "debug";
import { Contract, ContractReceipt } from "ethers";
import { ethers, waffle } from "hardhat";

import { OrderKind, SettlementEncoder, SigningScheme } from "../../src/ts";
import { BenchFixture } from "../fixture";

const debug = Debug("bench:uniswap:fixture");
const LOTS = ethers.utils.parseEther("10000000.0");

export interface BatchSwapOptions {
  batchSize: number;
  hops: number;
  useRouter: boolean;
}

export class UniswapFixture {
  private constructor(
    public readonly base: BenchFixture,
    public readonly weth: Contract,
    public readonly uniswapRouter: Contract,
  ) {}

  public static async create(): Promise<UniswapFixture> {
    const base = await BenchFixture.create();
    const {
      deployment: { deployer, weth },
      uniswapFactory,
    } = base;

    const uniswapRouter = await waffle.deployContract(
      deployer,
      UniswapV2Router,
      [uniswapFactory.address, weth.address],
    );

    return new UniswapFixture(base, weth, uniswapRouter);
  }

  public async batchSwap({
    batchSize,
    hops,
    useRouter,
  }: BatchSwapOptions): Promise<ContractReceipt> {
    const {
      base: {
        domainSeparator,
        nonce,
        settlement,
        solver,
        traders,
        uniswapFactory,
      },
      uniswapRouter,
    } = this;

    const path = await this.makeUniswapPath(hops);
    const pathAddresses = path.map(({ address }) => address);

    const sellToken = path[0];
    const buyToken = path[hops];

    const sellAmount = ethers.utils.parseEther("1.0");
    const totalSellAmount = sellAmount.mul(batchSize);
    const swapAmounts = await uniswapRouter.getAmountsOut(
      totalSellAmount,
      pathAddresses,
    );
    const totalBuyAmount = swapAmounts[hops];
    const buyAmount = totalBuyAmount.div(batchSize);
    const feeAmount = sellAmount.div(1000);
    debug(`swap amounts ${swapAmounts.join("->")}`);

    const encoder = new SettlementEncoder(domainSeparator);
    for (const trader of traders.slice(0, batchSize)) {
      await encoder.signEncodeTrade(
        {
          sellToken: sellToken.address,
          buyToken: buyToken.address,
          sellAmount,
          buyAmount,
          validTo: 0xffffffff,
          appData: nonce,
          feeAmount,
          kind: OrderKind.SELL,
          partiallyFillable: false,
        },
        trader,
        SigningScheme.EIP712,
      );
    }

    if (useRouter) {
      await this.sendSettlementPreApproval(sellToken, uniswapRouter.address);
      encoder.encodeInteraction({
        target: uniswapRouter.address,
        callData: uniswapRouter.interface.encodeFunctionData(
          "swapExactTokensForTokens",
          [
            totalSellAmount,
            totalBuyAmount.sub(1),
            pathAddresses,
            settlement.address,
            0xffffffff,
          ],
        ),
      });
    } else {
      encoder.encodeInteraction({
        target: sellToken.address,
        callData: sellToken.interface.encodeFunctionData("transfer", [
          await uniswapFactory.getPair(path[0].address, path[1].address),
          totalSellAmount,
        ]),
      });
      for (let i = 0; i < path.length - 1; i++) {
        const [input, output] = path.slice(i);
        const pair = await this.ensurePair(input, output);
        const token0 = await pair.token0();
        const amountOut = swapAmounts[i + 1];

        const [amount0Out, amount1Out] =
          input.address === token0 ? [0, amountOut] : [amountOut, 0];
        const to =
          i < path.length - 2
            ? await uniswapFactory.getPair(output.address, path[i + 2].address)
            : settlement.address;

        debug(`encoding pair swap ${amountOut} to ${to}`);
        encoder.encodeInteraction({
          target: pair.address,
          callData: pair.interface.encodeFunctionData("swap", [
            amount0Out,
            amount1Out,
            to,
            "0x",
          ]),
        });
      }
    }

    const transaction = await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [buyToken.address]: totalSellAmount,
        [sellToken.address]: totalBuyAmount,
      }),
    );

    return await transaction.wait();
  }

  public async directSwap(hops: number): Promise<ContractReceipt> {
    const {
      base: {
        traders: [trader],
      },
      uniswapRouter,
    } = this;

    const path = await this.makeUniswapPath(hops);

    await path[0]
      .connect(trader)
      .approve(uniswapRouter.address, ethers.constants.MaxUint256);

    const transaction = await uniswapRouter
      .connect(trader)
      .swapExactTokensForTokens(
        ethers.utils.parseEther("1.0"),
        ethers.utils.parseEther("0.1"),
        path.map(({ address }) => address),
        trader.address,
        0xffffffff,
      );
    return await transaction.wait();
  }

  private async makeUniswapPath(hops: number): Promise<Contract[]> {
    const {
      base: { tokens },
      weth,
    } = this;

    // NOTE: To simulate more "real-world" swaps, make the path chain one trade
    // through WETH if it is long enough.
    await tokens.ensureTokenCount(Math.max(2, hops));
    const path = [];
    let tokenId = 0;
    for (let hop = 0; hop < hops; hop++) {
      if (hop === 1) {
        path.push(weth);
      } else {
        path.push(tokens.id(tokenId));
        tokenId++;
      }
    }
    path.push(tokens.id(tokenId));

    for (let hop = 0; hop < hops; hop++) {
      const [tokenA, tokenB] = path.slice(hop);
      await this.ensurePair(tokenA, tokenB);
    }

    const symbols = [];
    for (const token of path) {
      symbols.push(await token.symbol());
    }
    debug(`swapping on path ${symbols.join("->")}`);

    return path;
  }

  private async ensurePair(
    tokenA: Contract,
    tokenB: Contract,
  ): Promise<Contract> {
    const {
      base: {
        deployment: { deployer },
        pooler,
        traders: [, primer],
        uniswapFactory,
      },
      uniswapRouter,
    } = this;

    let pairAddress = await uniswapFactory.getPair(
      tokenA.address,
      tokenB.address,
    );
    let newPair = false;
    if (pairAddress === ethers.constants.AddressZero) {
      const [symbolA, symbolB] = [await tokenA.symbol(), await tokenB.symbol()];
      debug(`creating new Uniswap pair ${symbolA}/${symbolB}`);
      await uniswapFactory.createPair(tokenA.address, tokenB.address);
      pairAddress = await uniswapFactory.getPair(
        tokenA.address,
        tokenB.address,
      );
      newPair = true;
    }

    const uniswapPair = new Contract(pairAddress, UniswapV2Pair.abi, deployer);
    if (newPair) {
      await this.mintToken(tokenA, uniswapPair.address);
      await this.mintToken(tokenB, uniswapPair.address);
      await uniswapPair.mint(pooler.address);

      // NOTE: In order to "prime" the storage used for swapping a pair
      // get a more accurate gas estimate, swap a small amount first;
      await this.mintToken(tokenA, primer.address);
      await tokenA
        .connect(primer)
        .approve(uniswapRouter.address, ethers.constants.MaxUint256);
      await uniswapRouter
        .connect(primer)
        .swapExactTokensForTokens(
          ethers.utils.parseEther("0.01"),
          0,
          [tokenA.address, tokenB.address],
          primer.address,
          0xffffffff,
        );
    }

    return uniswapPair;
  }

  private async mintToken(token: Contract, target: string): Promise<void> {
    const { pooler } = this.base;

    const symbol = await token.symbol();
    debug(`minting ${symbol}`);
    if (token.mint) {
      await token.mint(target, LOTS);
    } else {
      debug("depositing into WETH contract");
      const value = ethers.utils.parseEther("10.0");
      await pooler.sendTransaction({
        to: token.address,
        value,
      });
      await token.connect(pooler).transfer(target, value);
    }
  }

  private async sendSettlementPreApproval(
    token: Contract,
    target: string,
  ): Promise<void> {
    const { domainSeparator, settlement, solver } = this.base;

    const encoder = new SettlementEncoder(domainSeparator);
    encoder.encodeInteraction({
      target: token.address,
      callData: token.interface.encodeFunctionData("approve", [
        target,
        ethers.constants.MaxUint256,
      ]),
    });

    await settlement.connect(solver).settle(...encoder.encodedSettlement({}));
  }
}
