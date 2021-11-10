import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import IUniswapV2Router from "@uniswap/v2-periphery/build/IUniswapV2Router02.json";
import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import { InteractionLike, InteractionStage, TradeSimulator } from "../src/ts/";

function mockReturnsInteraction(
  mock: MockContract,
  method: string,
  params: unknown[],
  result: unknown[],
): InteractionLike {
  const doppelganger = new ethers.utils.Interface([
    "function __waffle__mockReturns(bytes memory data, bytes memory value)",
  ]);
  return {
    target: mock.address,
    callData: doppelganger.encodeFunctionData("__waffle__mockReturns", [
      mock.interface.encodeFunctionData(method, params),
      mock.interface.encodeFunctionResult(method, result),
    ]),
  };
}

describe("GPv2TradeSimulator", () => {
  const [deployer, owner, trader, receive] = waffle.provider.getWallets();
  let settlement: Contract;
  let tradeSimulator: TradeSimulator;
  let tokens: [MockContract, MockContract];
  let router: MockContract;

  beforeEach(async () => {
    const GPv2AllowListAuthentication = await ethers.getContractFactory(
      "GPv2AllowListAuthentication",
      deployer,
    );
    const authenticator = await GPv2AllowListAuthentication.deploy();
    await authenticator.initializeManager(owner.address);

    const IVault = await artifacts.readArtifact("IVault");
    const vault = await waffle.deployMockContract(deployer, IVault.abi);

    const GPv2Settlement = await ethers.getContractFactory(
      "GPv2SettlementTestInterface",
      deployer,
    );
    settlement = await GPv2Settlement.deploy(
      authenticator.address,
      vault.address,
    );

    const GPv2TradeSimulator = await ethers.getContractFactory(
      "GPv2TradeSimulator",
      deployer,
    );
    tradeSimulator = new TradeSimulator(
      settlement,
      await GPv2TradeSimulator.deploy(),
    );

    tokens = [
      await waffle.deployMockContract(deployer, IERC20.abi),
      await waffle.deployMockContract(deployer, IERC20.abi),
    ];
    router = await waffle.deployMockContract(deployer, IUniswapV2Router.abi);
  });

  describe("simulateTrade", () => {
    it("computes account balance changes", async () => {
      const sellAmount = ethers.utils.parseEther("42");
      const sellRoundingError = 1;
      const buyAmount = ethers.utils.parseEther("13.37");
      const buyPositiveSlippage = 1001;

      for (const receiver of [ethers.constants.AddressZero, receive.address]) {
        const actualReceiver =
          receiver === ethers.constants.AddressZero ? trader.address : receiver;
        const swapArgs = [
          sellAmount,
          buyAmount,
          [tokens[0].address, tokens[1].address],
          settlement.address,
          0xffffffff,
        ];

        await tokens[0].mock.balanceOf.withArgs(settlement.address).returns(0);
        await tokens[1].mock.balanceOf.withArgs(settlement.address).returns(0);

        await tokens[0].mock.balanceOf
          .withArgs(trader.address)
          .returns(sellAmount);
        await tokens[1].mock.balanceOf.withArgs(actualReceiver).returns(0);

        await tokens[0].mock.transferFrom
          .withArgs(trader.address, settlement.address, sellAmount)
          .returns(true);
        await router.mock.swapExactTokensForTokens
          .withArgs(...swapArgs)
          .returns([sellAmount, buyAmount.add(buyPositiveSlippage)]);
        await tokens[1].mock.transfer
          .withArgs(actualReceiver, buyAmount)
          .returns(true);

        const { contractBalance, ownerBalance } =
          await tradeSimulator.simulateTrade(
            {
              owner: trader.address,
              sellToken: tokens[0].address,
              buyToken: tokens[1].address,
              receiver,
              sellAmount,
              buyAmount,
            },
            {
              [InteractionStage.INTRA]: [
                {
                  target: router.address,
                  callData: router.interface.encodeFunctionData(
                    "swapExactTokensForTokens",
                    swapArgs,
                  ),
                },
              ],
              // Use post-interactions to change mock configuration to simulate
              // balance changes.
              [InteractionStage.POST]: [
                mockReturnsInteraction(
                  tokens[0],
                  "balanceOf",
                  [settlement.address],
                  [sellRoundingError],
                ),
                mockReturnsInteraction(
                  tokens[1],
                  "balanceOf",
                  [settlement.address],
                  [buyPositiveSlippage],
                ),
                mockReturnsInteraction(
                  tokens[0],
                  "balanceOf",
                  [trader.address],
                  [0],
                ),
                mockReturnsInteraction(
                  tokens[1],
                  "balanceOf",
                  [actualReceiver],
                  [buyAmount],
                ),
              ],
            },
          );

        expect(contractBalance.sellTokenDelta).to.equal(sellRoundingError);
        expect(contractBalance.buyTokenDelta).to.equal(buyPositiveSlippage);
        expect(ownerBalance.sellTokenDelta).to.equal(sellAmount.mul(-1));
        expect(ownerBalance.buyTokenDelta).to.equal(buyAmount);
      }
    });

    it("computes gas usage", async () => {
      await tokens[0].mock.balanceOf.withArgs(settlement.address).returns(0);
      await tokens[1].mock.balanceOf.withArgs(settlement.address).returns(0);

      await tokens[0].mock.balanceOf.withArgs(trader.address).returns(0);
      await tokens[1].mock.balanceOf.withArgs(trader.address).returns(0);

      await tokens[0].mock.transferFrom
        .withArgs(trader.address, settlement.address, 0)
        .returns(true);
      await tokens[1].mock.transfer.withArgs(trader.address, 0).returns(true);

      const { gasUsed } = await tradeSimulator.simulateTrade(
        {
          owner: trader.address,
          sellToken: tokens[0].address,
          buyToken: tokens[1].address,
          sellAmount: 0,
          buyAmount: 0,
        },
        {},
      );

      expect(gasUsed.gt(10000) && gasUsed.lt(1000000)).to.be.true;
    });

    it("computes executed buy amount settlement contract balance change", async () => {
      const initialBuyTokenBalance = ethers.utils.parseEther("13.37");
      const actualBuyAmount = ethers.utils.parseEther("4.2");

      await tokens[0].mock.balanceOf.withArgs(settlement.address).returns(0);
      await tokens[1].mock.balanceOf
        .withArgs(settlement.address)
        .returns(initialBuyTokenBalance);

      await tokens[0].mock.balanceOf.withArgs(trader.address).returns(0);
      await tokens[1].mock.balanceOf.withArgs(trader.address).returns(0);

      await tokens[0].mock.transferFrom
        .withArgs(trader.address, settlement.address, 0)
        .returns(true);
      await tokens[1].mock.transfer
        .withArgs(trader.address, actualBuyAmount)
        .returns(true);

      const { executedBuyAmount } = await tradeSimulator.simulateTrade(
        {
          owner: trader.address,
          sellToken: tokens[0].address,
          buyToken: tokens[1].address,
          sellAmount: 0,
          buyAmount: 0,
        },
        {
          [InteractionStage.INTRA]: [
            mockReturnsInteraction(
              tokens[1],
              "balanceOf",
              [settlement.address],
              [initialBuyTokenBalance.add(actualBuyAmount)],
            ),
          ],
        },
      );

      expect(executedBuyAmount).to.equal(actualBuyAmount);
    });
  });
});
