import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { BigNumber, BigNumberish, Contract, utils } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import { OrderKind, SigningScheme, Trade, encodeTradeFlags } from "../src/ts";

function fillAddress(byte: number): string {
  return ethers.utils.hexlify([...Array(20)].map(() => byte));
}

async function interfaceFor(name: string): Promise<utils.Interface> {
  const { abi } = await artifacts.readArtifact(name);
  return new ethers.utils.Interface(abi);
}

function getAmountOut(
  amountIn: BigNumber,
  reserveIn: BigNumber,
  reserveOut: BigNumber,
): BigNumber {
  const amountInWithFee = amountIn.mul(997);
  const numerator = amountInWithFee.mul(reserveOut);
  const denominator = reserveIn.mul(1000).add(amountInWithFee);
  return numerator.div(denominator);
}

function getAmountIn(
  amountOut: BigNumber,
  reserveIn: BigNumber,
  reserveOut: BigNumber,
): BigNumber {
  const numerator = reserveIn.mul(amountOut).mul(1000);
  const denominator = reserveOut.sub(amountOut).mul(997);
  return numerator.div(denominator).add(1);
}

describe("GPv2UniswapRouter", () => {
  const [deployer] = waffle.provider.getWallets();

  let settlement: MockContract;
  let uniswapFactory: MockContract;
  let uniswapRouter: Contract;

  let IERC20: utils.Interface;
  let IUniswapV2Pair: utils.Interface;

  beforeEach(async () => {
    const GPv2Settlement = await artifacts.readArtifact("GPv2Settlement");
    settlement = await waffle.deployMockContract(deployer, GPv2Settlement.abi);

    const UniswapV2Factory = await artifacts.readArtifact("IUniswapV2Factory");
    uniswapFactory = await waffle.deployMockContract(
      deployer,
      UniswapV2Factory.abi,
    );
    await uniswapFactory.mock.getPair.returns(ethers.constants.AddressZero);

    const GPv2UniswapRouter = await ethers.getContractFactory(
      "GPv2UniswapRouterTestInterface",
    );
    uniswapRouter = await GPv2UniswapRouter.deploy(
      settlement.address,
      uniswapFactory.address,
    );

    IERC20 = await interfaceFor("src/contracts/interfaces/IERC20.sol:IERC20");
    IUniswapV2Pair = await interfaceFor("IUniswapV2Pair");
  });

  describe("settlement", () => {
    it("should be set", async () => {
      expect(await uniswapRouter.settlement()).to.equal(settlement.address);
    });
  });

  describe("factory", () => {
    it("should be set", async () => {
      expect(await uniswapRouter.factory()).to.equal(uniswapFactory.address);
    });
  });

  function sortTokens(tokenA: string, tokenB: string): [string, string] {
    return tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];
  }

  function pairFor(tokenA: string, tokenB: string): string {
    const [token0, token1] = sortTokens(tokenA, tokenB);
    return ethers.utils.getAddress(
      ethers.utils.hexDataSlice(
        ethers.utils.solidityKeccak256(
          ["bytes1", "address", "bytes32", "bytes32"],
          [
            "0xff",
            uniswapFactory.address,
            ethers.utils.solidityKeccak256(
              ["address", "address"],
              [token0, token1],
            ),
            "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f",
          ],
        ),
        12,
      ),
    );
  }

  async function deployMockPair(
    tokenA: string,
    tokenB: string,
  ): Promise<MockContract> {
    const { abi } = await artifacts.readArtifact("IUniswapV2Pair");
    const pair = await waffle.deployMockContract(deployer, abi);
    await uniswapFactory.mock.getPair
      .withArgs(tokenA, tokenB)
      .returns(pair.address);
    await uniswapFactory.mock.getPair
      .withArgs(tokenB, tokenA)
      .returns(pair.address);

    return pair;
  }

  describe("settleSwap", () => {
    function sampleTrade({
      kind,
      ...flags
    }: {
      kind: OrderKind;
      sellTokenIndex: number;
      buyTokenIndex: number;
      sellAmount: BigNumberish;
      buyAmount: BigNumberish;
    }): Trade {
      return {
        receiver: ethers.constants.AddressZero,
        validTo: 0xffffffff,
        appData: `0x${"beefc0de".repeat(8)}`,
        feeAmount: ethers.utils.parseEther("0.1337"),
        flags: encodeTradeFlags({
          kind,
          partiallyFillable: false,
          signingScheme: SigningScheme.EIP712,
        }),
        executedAmount: 0,
        signature: `0x${"51".repeat(65)}`,
        ...flags,
      };
    }

    it("reverts for paths without at least two tokens", async () => {
      await expect(
        uniswapRouter.settleSwap(
          [fillAddress(1)],
          sampleTrade({
            kind: OrderKind.SELL,
            sellTokenIndex: 0,
            buyTokenIndex: 0,
            sellAmount: ethers.constants.Zero,
            buyAmount: ethers.constants.Zero,
          }),
          0,
        ),
      ).to.be.revertedWith("invalid path");
    });

    it("reverts for trades that do not correspond to specified path", async () => {
      await expect(
        uniswapRouter.settleSwap(
          [fillAddress(1), fillAddress(2)],
          sampleTrade({
            kind: OrderKind.SELL,
            // NOTE: The trade is going in the opposite direction of the path.
            sellTokenIndex: 1,
            buyTokenIndex: 0,
            sellAmount: ethers.constants.Zero,
            buyAmount: ethers.constants.Zero,
          }),
          0,
        ),
      ).to.be.revertedWith("invalid trade for path");
    });

    it("executes a settlement with a single swap", async () => {
      const pair = await deployMockPair(fillAddress(1), fillAddress(2));
      const [reserveSell, reserveBuy] = [
        ethers.utils.parseEther("200000.0"),
        ethers.utils.parseEther("100.0"),
      ];

      const sellAmount = ethers.utils.parseEther("1.0");
      const buyAmount = ethers.utils.parseEther("0.0003");
      const amountOut = getAmountOut(sellAmount, reserveSell, reserveBuy);

      const trade = sampleTrade({
        kind: OrderKind.SELL,
        sellTokenIndex: 0,
        buyTokenIndex: 1,
        sellAmount,
        buyAmount,
      });

      await pair.mock.getReserves.returns(reserveSell, reserveBuy, 0);
      await settlement.mock.settle
        .withArgs(
          [fillAddress(1), fillAddress(2)],
          [amountOut, sellAmount],
          [trade],
          [
            [],
            [
              {
                target: fillAddress(1),
                value: ethers.constants.Zero,
                callData: IERC20.encodeFunctionData("transfer", [
                  pair.address,
                  sellAmount,
                ]),
              },
              {
                target: pair.address,
                value: ethers.constants.Zero,
                callData: IUniswapV2Pair.encodeFunctionData("swap", [
                  0,
                  amountOut,
                  settlement.address,
                  "0x",
                ]),
              },
            ],
            [],
          ],
        )
        .returns();

      await expect(
        uniswapRouter.settleSwap(
          [fillAddress(1), fillAddress(2)],
          trade,
          buyAmount,
        ),
      ).to.not.be.reverted;
    });

    describe("Swap Amounts", () => {
      const path = [fillAddress(1), fillAddress(42), fillAddress(2)];
      const pairReserves = [
        {
          reserve0: ethers.utils.parseEther("100.0"), // T1
          reserve1: ethers.utils.parseEther("200.0"), // T42
        },
        {
          reserve0: ethers.utils.parseEther("300.0"), // T2
          reserve1: ethers.utils.parseEther("400.0"), // T42
        },
      ];

      const sellAmount = ethers.utils.parseEther("1.0");
      const buyAmount = ethers.utils.parseEther("1.0");

      async function swapWithAmounts(kind: OrderKind, amounts: BigNumber[]) {
        const trade = sampleTrade({
          kind,
          sellTokenIndex: 0,
          buyTokenIndex: 2,
          sellAmount,
          buyAmount,
        });
        const limitAmount = kind == OrderKind.SELL ? buyAmount : sellAmount;

        const pairs: MockContract[] = [];
        for (const [i, { reserve0, reserve1 }] of pairReserves.entries()) {
          const [tokenIn, tokenOut] = path.slice(i);
          const pair = await deployMockPair(tokenIn, tokenOut);
          await pair.mock.getReserves.returns(reserve0, reserve1, 0);

          pairs.push(pair);
        }

        await settlement.mock.settle
          .withArgs(
            path,
            [amounts[amounts.length - 1], 0, amounts[0]],
            [trade],
            [
              [],
              [
                {
                  target: path[0],
                  value: ethers.constants.Zero,
                  callData: IERC20.encodeFunctionData("transfer", [
                    pairs[0].address,
                    amounts[0],
                  ]),
                },
                ...pairs.map((pair, i) => {
                  const [tokenIn, tokenOut] = path.slice(i);
                  const [token0] = sortTokens(tokenIn, tokenOut);
                  return {
                    target: pair.address,
                    value: ethers.constants.Zero,
                    callData: IUniswapV2Pair.encodeFunctionData("swap", [
                      tokenIn == token0 ? 0 : amounts[i + 1],
                      tokenIn == token0 ? amounts[i + 1] : 0,
                      (pairs[i + 1] ?? settlement).address,
                      "0x",
                    ]),
                  };
                }),
              ],
              [],
            ],
          )
          .returns();

        return uniswapRouter.settleSwap(path, trade, limitAmount);
      }

      it("computes correct swap amounts for multi-hop sell orders", async () => {
        const intermediateAmount = getAmountOut(
          sellAmount,
          pairReserves[0].reserve0,
          pairReserves[0].reserve1,
        );
        const executedBuyAmount = getAmountOut(
          intermediateAmount,
          // NOTE: The second hop has tokens in reverse sorting order, so make
          // sure to adjust reserves accordingly.
          pairReserves[1].reserve1,
          pairReserves[1].reserve0,
        );

        await expect(
          swapWithAmounts(OrderKind.SELL, [
            sellAmount,
            intermediateAmount,
            executedBuyAmount,
          ]),
        ).to.not.be.reverted;
      });

      it("computes correct swap amounts for multi-hop buy orders", async () => {
        const intermediateAmount = getAmountIn(
          buyAmount,
          // NOTE: The second hop has tokens in reverse sorting order, so make
          // sure to adjust reserves accordingly.
          pairReserves[1].reserve1,
          pairReserves[1].reserve0,
        );
        const executedSellAmount = getAmountIn(
          intermediateAmount,
          pairReserves[0].reserve0,
          pairReserves[0].reserve1,
        );

        await expect(
          swapWithAmounts(OrderKind.BUY, [
            executedSellAmount,
            intermediateAmount,
            buyAmount,
          ]),
        ).to.not.be.reverted;
      });
    });

    describe("Limit Amounts", () => {
      it("reverts when sell order swap receives less than the limit", async () => {
        const path = [fillAddress(1), fillAddress(2)];
        const pair = await deployMockPair(path[0], path[1]);

        const sellAmount = ethers.utils.parseEther("1.0");
        const trade = sampleTrade({
          kind: OrderKind.SELL,
          sellTokenIndex: 0,
          buyTokenIndex: 1,
          sellAmount,
          // NOTE: Trade would be happy receiving nothing.
          buyAmount: ethers.constants.Zero,
        });

        const [reserveSell, reserveBuy] = [
          ethers.utils.parseEther("200.0"),
          ethers.utils.parseEther("100.0"),
        ];
        const amountOut = getAmountOut(sellAmount, reserveSell, reserveBuy);

        await pair.mock.getReserves.returns(reserveSell, reserveBuy, 0);
        await expect(
          uniswapRouter.settleSwap(path, trade, amountOut.add(1)),
        ).to.be.revertedWith("swap out too low");
      });

      it("reverts when buy order swap sends more than the limit", async () => {
        const path = [fillAddress(1), fillAddress(2)];
        const pair = await deployMockPair(path[0], path[1]);

        const buyAmount = ethers.utils.parseEther("1.0");
        const trade = sampleTrade({
          kind: OrderKind.BUY,
          sellTokenIndex: 0,
          buyTokenIndex: 1,
          // NOTE: Trade would be happy paying everything.
          sellAmount: ethers.constants.MaxUint256,
          buyAmount,
        });

        const [reserveSell, reserveBuy] = [
          ethers.utils.parseEther("200.0"),
          ethers.utils.parseEther("100.0"),
        ];
        const amountIn = getAmountIn(buyAmount, reserveSell, reserveBuy);

        await pair.mock.getReserves.returns(reserveSell, reserveBuy, 0);
        await expect(
          uniswapRouter.settleSwap(path, trade, amountIn.sub(1)),
        ).to.be.revertedWith("swap in too high");
      });
    });
  });

  describe("transferInteraction", () => {
    it("should encode a transfer for the first swap amount of the first token", async () => {
      const {
        target,
        value,
        callData,
      } = await uniswapRouter.transferInteractionTest(
        [fillAddress(1), fillAddress(2), fillAddress(3)],
        [ethers.utils.parseEther("1.0"), ethers.utils.parseEther("2.0")],
      );

      expect({ target, value, callData }).to.deep.equal({
        target: fillAddress(1),
        value: ethers.constants.Zero,
        callData: IERC20.encodeFunctionData("transfer", [
          pairFor(fillAddress(1), fillAddress(2)),
          ethers.utils.parseEther("1.0"),
        ]),
      });
    });
  });

  describe("swapInteraction", () => {
    it("should encode a swap for the given tokens and receiver", async () => {
      const {
        target,
        value,
        callData,
      } = await uniswapRouter.swapInteractionTest(
        fillAddress(1),
        fillAddress(2),
        ethers.utils.parseEther("1.0"),
        fillAddress(3),
      );

      expect({ target, value, callData }).to.deep.equal({
        target: pairFor(fillAddress(1), fillAddress(2)),
        value: ethers.constants.Zero,
        callData: IUniswapV2Pair.encodeFunctionData("swap", [
          ethers.constants.Zero,
          ethers.utils.parseEther("1.0"),
          fillAddress(3),
          "0x",
        ]),
      });
    });

    it("correctly orders the tokens", async () => {
      const { callData } = await uniswapRouter.swapInteractionTest(
        // NOTE: `fillAddress(2) > fillAddress(1)`, this means that the pair's
        // `token0` is `tokenOut` in this case.
        fillAddress(2),
        fillAddress(1),
        ethers.utils.parseEther("1.0"),
        fillAddress(3),
      );

      expect(callData).to.deep.equal(
        IUniswapV2Pair.encodeFunctionData("swap", [
          ethers.utils.parseEther("1.0"),
          ethers.constants.Zero,
          fillAddress(3),
          "0x",
        ]),
      );
    });
  });
});
