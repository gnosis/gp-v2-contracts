import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  InteractionLike,
  InteractionStage,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TradeSimulator,
  TypedDataDomain,
  domain,
  TradeSimulation,
} from "../../src/ts";

import { deployTestContracts } from "./fixture";

describe("E2E: Simulates Uniswap Trade", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let pooler: Wallet;
  let trader: Wallet;

  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;
  let tradeSimulator: TradeSimulator;

  let weth: Contract;
  let usdt: Contract;
  let unsupportedToken: Contract;
  let uniswapFactory: Contract;
  let uniswapRouter: Contract;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      vaultRelayer,
      wallets: [solver, pooler, trader],
    } = deployment);

    const { authenticator, manager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);
    tradeSimulator = new TradeSimulator(settlement, deployment.tradeSimulator);

    const TestERC20 = await ethers.getContractFactory("TestERC20");
    weth = await TestERC20.deploy("WETH", 18);
    usdt = await TestERC20.deploy("USDT", 6);

    const FeeClaimingERC20 = await ethers.getContractFactory(
      "FeeClaimingERC20",
    );
    unsupportedToken = await FeeClaimingERC20.deploy();

    uniswapFactory = await waffle.deployContract(deployer, UniswapV2Factory, [
      deployer.address,
    ]);
    uniswapRouter = await waffle.deployContract(deployer, UniswapV2Router02, [
      uniswapFactory.address,
      weth.address,
    ]);
  });

  async function createPair(tokenA: string, tokenB: string): Promise<Contract> {
    await uniswapFactory.createPair(tokenA, tokenB);
    return new Contract(
      await uniswapFactory.getPair(tokenA, tokenB),
      UniswapV2Pair.abi,
      deployer,
    );
  }

  async function transactionGasOverhead(
    transactionHash: string,
  ): Promise<number> {
    const { data } = await ethers.provider.getTransaction(transactionHash);
    const bytes = ethers.utils.arrayify(data);

    let calldataGas = 0;
    for (const byte of bytes) {
      calldataGas += byte === 0 ? 4 : 16;
    }

    return 21000 + calldataGas;
  }

  it("should simulate a trade", async () => {
    const wethUsdt = await createPair(weth.address, usdt.address);
    await weth.mint(wethUsdt.address, ethers.utils.parseEther("1000.0"));
    await usdt.mint(wethUsdt.address, ethers.utils.parseUnits("4500000.0", 6));
    await wethUsdt.mint(pooler.address);

    await weth.mint(trader.address, ethers.utils.parseEther("1.000"));
    await weth
      .connect(trader)
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);

    const swapInteractions = [
      {
        target: weth.address,
        callData: weth.interface.encodeFunctionData("approve", [
          uniswapRouter.address,
          ethers.constants.MaxUint256,
        ]),
      },
      {
        target: uniswapRouter.address,
        callData: uniswapRouter.interface.encodeFunctionData(
          "swapExactTokensForTokens",
          [
            ethers.utils.parseEther("0.999"),
            1, // market order, YOLO!
            [weth.address, usdt.address],
            settlement.address,
            0xffffffff,
          ],
        ),
      },
    ];

    const { gasUsed: simulatedGasUsed, executedBuyAmount } =
      await tradeSimulator.simulateTrade(
        {
          owner: trader.address,
          sellToken: weth.address,
          buyToken: usdt.address,
          sellAmount: ethers.utils.parseEther("0.999"),
          buyAmount: 0,
        },
        {
          [InteractionStage.INTRA]: swapInteractions,
        },
      );

    const encoder = new SettlementEncoder(domainSeparator);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: weth.address,
        buyToken: usdt.address,
        sellAmount: ethers.utils.parseEther("0.999"),
        buyAmount: ethers.utils.parseUnits("4000.0", 6),
        feeAmount: ethers.utils.parseEther("0.001"),
        validTo: 0xffffffff,
        appData: 1,
      },
      trader,
      SigningScheme.EIP712,
    );
    for (const interaction of swapInteractions) {
      encoder.encodeInteraction(interaction);
    }

    const tx = await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [weth.address]: executedBuyAmount,
        [usdt.address]: ethers.utils.parseEther("0.999"),
      }),
    );
    const { transactionHash, gasUsed: actualGasUsed } = await tx.wait();

    expect(await weth.balanceOf(trader.address)).to.equal(0);
    expect(await weth.balanceOf(settlement.address)).to.equal(
      ethers.utils.parseEther("0.001"),
    );
    expect(await usdt.balanceOf(trader.address)).to.equal(executedBuyAmount);

    const gasOverhead = await transactionGasOverhead(transactionHash);
    const gasUsageRatio =
      (actualGasUsed.toNumber() - simulatedGasUsed.toNumber() - gasOverhead) /
      actualGasUsed.toNumber();
    console.log(
      `Simulated trade used ${simulatedGasUsed} (+${gasOverhead}) and cost ${actualGasUsed} ` +
        `(${(gasUsageRatio * 100).toFixed(2)}% difference)`,
    );
    expect(gasUsageRatio).to.be.lessThan(0.05);
  });

  it("should revert if without allowance and balance", async () => {
    const simulation = [
      {
        owner: trader.address,
        sellToken: weth.address,
        buyToken: usdt.address,
        sellAmount: ethers.utils.parseEther("1.000"),
        buyAmount: 0,
      },
      {},
    ] as const;

    await expect(tradeSimulator.simulateTrade(...simulation)).to.be.reverted;

    await weth.mint(trader.address, ethers.utils.parseEther("1.000"));
    await expect(tradeSimulator.simulateTrade(...simulation)).to.be.reverted;

    await weth
      .connect(trader)
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    await expect(tradeSimulator.simulateTrade(...simulation)).to.not.be
      .reverted;
  });

  it("should revert when trading unsupported tokens", async () => {
    for (const pair of [
      await createPair(weth.address, unsupportedToken.address),
      await createPair(weth.address, usdt.address),
    ]) {
      for (const token of [weth, unsupportedToken, usdt]) {
        await token.mint(pair.address, ethers.utils.parseEther("1000.0"));
      }
      await pair.mint(pooler.address);
    }

    const sellAmount = ethers.utils.parseEther("1.0");
    for (const token of [weth, unsupportedToken, usdt]) {
      await token.mint(trader.address, sellAmount);
      await token
        .connect(trader)
        .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    }

    const simulation = async (
      sellToken: Contract,
      buyToken: Contract,
    ): Promise<
      [TradeSimulation, Partial<Record<InteractionStage, InteractionLike[]>>]
    > => {
      const [, buyAmount] = await uniswapRouter.getAmountsOut(sellAmount, [
        sellToken.address,
        buyToken.address,
      ]);
      return [
        {
          owner: trader.address,
          sellToken: sellToken.address,
          buyToken: buyToken.address,
          sellAmount,
          buyAmount: buyAmount.mul(9999).div(10000), // add some slippage
        },
        {
          [InteractionStage.INTRA]: [
            {
              target: sellToken.address,
              callData: sellToken.interface.encodeFunctionData("approve", [
                uniswapRouter.address,
                ethers.constants.MaxUint256,
              ]),
            },
            {
              target: uniswapRouter.address,
              callData: uniswapRouter.interface.encodeFunctionData(
                "swapExactTokensForTokens",
                [
                  sellAmount,
                  1, // market order, YOLO!
                  [sellToken.address, buyToken.address],
                  settlement.address,
                  0xffffffff,
                ],
              ),
            },
          ],
        },
      ];
    };

    await expect(
      tradeSimulator.simulateTrade(
        ...(await simulation(weth, unsupportedToken)),
      ),
    ).to.be.reverted;
    await expect(
      tradeSimulator.simulateTrade(
        ...(await simulation(unsupportedToken, weth)),
      ),
    ).to.be.reverted;

    // Check there is nothing wrong with our test by asserting that the same
    // simulation with supported tokens work.
    await expect(
      tradeSimulator.simulateTrade(...(await simulation(weth, usdt))),
    ).to.not.be.reverted;
    await expect(
      tradeSimulator.simulateTrade(...(await simulation(usdt, weth))),
    ).to.not.be.reverted;
  });
});
