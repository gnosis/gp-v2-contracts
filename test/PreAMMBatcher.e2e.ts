import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import { use, expect } from "chai";
import { debug } from "debug";
import { deployContract, MockProvider, solidity } from "ethereum-waffle";
import { BigNumber, Contract, Wallet } from "ethers";

import PreAMMBatcher from "../build/artifacts/PreAMMBatcher.json";
import { Order } from "../src/js/orders.spec";

import { generateTestCase } from "./resources";
import { TestCase } from "./resources/models";
import {
  baseTestInput,
  fourOrderTestInput,
  oneOrderSellingToken0IsOmittedTestInput,
  oneOrderSellingToken1IsOmittedTestInput,
  noSolutionTestInput,
  switchTokenTestInput,
} from "./resources/testExamples";

const log = debug("PreAMMBatcher.e2e");
use(solidity);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function asyncForEach(array: Order[], callback: any): Promise<void> {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

const setupOrders = async (
  orders: Order[],
  batcher: Contract,
): Promise<void> => {
  await asyncForEach(orders, async (order: Order) => {
    await order.sellToken.mint(order.wallet.address, order.sellAmount);
    await order.sellToken
      .connect(order.wallet)
      .approve(batcher.address, order.sellAmount);
  });
};

const fundUniswap = async (
  testCase: TestCase,
  walletDeployer: Wallet,
  uniswapPair: Contract,
): Promise<void> => {
  const token0 = testCase.sellOrdersToken0[0].sellToken;
  const token1 = testCase.sellOrdersToken0[0].buyToken;
  await token0.mint(walletDeployer.address, testCase.fundingAMMToken0);
  await token1.mint(walletDeployer.address, testCase.fundingAMMToken1);
  await token0.transfer(uniswapPair.address, testCase.fundingAMMToken0);
  await token1.transfer(uniswapPair.address, testCase.fundingAMMToken0);
  await uniswapPair.mint(walletDeployer.address, { gasLimit: 500000 });
};
describe("PreAMMBatcher: End to End Tests", () => {
  const [
    walletDeployer,
    walletTrader1,
    walletTrader2,
    walletTrader3,
    walletTrader4,
    walletTrader5,
    walletTrader6,
  ] = new MockProvider().getWallets();
  let batcher: Contract;
  let token0: Contract;
  let token1: Contract;
  let uniswapPair: Contract;
  let uniswapFactory: Contract;
  let uniswapPairAddress: string;

  const runScenarioOnchain = async (testCase: TestCase): Promise<void> => {
    await fundUniswap(testCase, walletDeployer, uniswapPair);
    await setupOrders(
      testCase.sellOrdersToken0.concat(testCase.sellOrdersToken1),
      batcher,
    );

    if (testCase.solution.sellOrdersToken0.length === 0) {
      await expect(
        batcher.batchTrade(
          testCase.getSellOrdersToken0Encoded(),
          testCase.getSellOrdersToken1Encoded(),
          { gasLimit: 6000000 },
        ),
      ).to.be.revertedWith("no solution found");
    } else {
      await expect(
        batcher.batchTrade(
          testCase.getSellOrdersToken0Encoded(),
          testCase.getSellOrdersToken1Encoded(),
          { gasLimit: 6000000 },
        ),
      )
        .to.emit(batcher, "BatchSettlement")
        .withArgs(
          testCase.solution.sellOrdersToken0[0].sellToken.address,
          testCase.solution.sellOrdersToken0[0].buyToken.address,
          testCase.solution.clearingPrice.denominator,
          testCase.solution.clearingPrice.numerator,
        );

      await asyncForEach(
        testCase.solution.sellOrdersToken0,
        async (order: Order) => {
          expect(
            await order.buyToken.balanceOf(order.wallet.address),
          ).to.be.equal(
            order.sellAmount
              .mul(testCase.solution.clearingPrice.denominator)
              .div(testCase.solution.clearingPrice.numerator)
              .mul(332)
              .div(333),
          );
        },
      );
      await asyncForEach(
        testCase.solution.sellOrdersToken1,
        async (order: Order) => {
          expect(
            await order.buyToken.balanceOf(order.wallet.address),
          ).to.be.equal(
            order.sellAmount
              .mul(testCase.solution.clearingPrice.numerator)
              .div(testCase.solution.clearingPrice.denominator)
              .mul(332)
              .div(333),
          );
        },
      );
    }
  };

  beforeEach(async () => {
    token0 = await deployContract(walletDeployer, ERC20, ["token0", "18"]);
    token1 = await deployContract(walletDeployer, ERC20, ["token1", "18"]);
    uniswapFactory = await deployContract(walletDeployer, UniswapV2Factory, [
      walletDeployer.address,
    ]);
    await uniswapFactory.createPair(token0.address, token1.address, {
      gasLimit: 6000000,
    });
    uniswapPairAddress = await uniswapFactory.getPair(
      token0.address,
      token1.address,
    );
    uniswapPair = await deployContract(walletDeployer, UniswapV2Pair);
    uniswapPair = await uniswapPair.attach(uniswapPairAddress);
    batcher = await deployContract(walletDeployer, PreAMMBatcher, [
      uniswapFactory.address,
    ]);
  });
  describe("Example Scenarios", async () => {
    it("clears baseTestInput - two generic overlapping orders", async () => {
      const testCase = generateTestCase(
        baseTestInput(
          token0,
          token1,
          [walletTrader1, walletTrader2],
          [walletTrader3, walletTrader4],
        ),
      );
      expect(testCase.solution.sellOrdersToken0.length).to.be.equal(1);
      expect(testCase.solution.sellOrdersToken1.length).to.be.equal(1);
      await runScenarioOnchain(testCase);
      log(
        "auction clearing price: " +
          testCase.solution.clearingPrice.numerator
            .mul(BigNumber.from("100000"))
            .div(testCase.solution.clearingPrice.denominator)
            .toString(),
      );
      log(
        "uniswap clearing price: " +
          (await uniswapPair.getReserves())[0]
            .mul(100000)
            .div((await uniswapPair.getReserves())[1])
            .toString(),
      );
    });
    it("pre-batches four orders and settles left-overs to uniswap", async () => {
      const testCase = generateTestCase(
        fourOrderTestInput(
          token0,
          token1,
          [walletTrader1, walletTrader2],
          [walletTrader3, walletTrader4],
        ),
      );
      await runScenarioOnchain(testCase);
    });

    it("omits one order selling token 0", async () => {
      const testCase = generateTestCase(
        oneOrderSellingToken0IsOmittedTestInput(
          token0,
          token1,
          [walletTrader1, walletTrader2],
          [walletTrader3, walletTrader4],
        ),
      );
      expect(testCase.solution.sellOrdersToken0.length).to.be.equal(1);
      expect(testCase.solution.sellOrdersToken1.length).to.be.equal(1);
      await runScenarioOnchain(testCase);
    });
    it("omits one order selling token 1", async () => {
      const testCase = generateTestCase(
        oneOrderSellingToken1IsOmittedTestInput(
          token0,
          token1,
          [walletTrader1, walletTrader2, walletTrader5, walletTrader6],
          [walletTrader3, walletTrader4],
        ),
      );

      expect(testCase.solution.sellOrdersToken0.length).to.be.equal(3);
      expect(testCase.solution.sellOrdersToken1.length).to.be.equal(2);
      await runScenarioOnchain(testCase);
    });
    it("clears auciton with no solution", async () => {
      const testCase = generateTestCase(
        noSolutionTestInput(
          token0,
          token1,
          [walletTrader1, walletTrader2, walletTrader5],
          [walletTrader3, walletTrader4, walletTrader6],
        ),
      );

      expect(testCase.solution.sellOrdersToken0.length).to.be.equal(0);
      expect(testCase.solution.sellOrdersToken1.length).to.be.equal(0);
      await runScenarioOnchain(testCase);
    });
    it("switchTokenTestInput", async () => {
      const testCase = generateTestCase(
        switchTokenTestInput(
          token0,
          token1,
          [walletTrader1, walletTrader2],
          [walletTrader3, walletTrader4, walletTrader5, walletTrader6],
        ),
      );

      expect(testCase.solution.sellOrdersToken0.length).to.be.equal(3);
      expect(testCase.solution.sellOrdersToken1.length).to.be.equal(2);
      await runScenarioOnchain(testCase);
    });
  });
  describe("Bad encoded order", async () => {
    it("rejects invalid signatures", async () => {
      const testCase = generateTestCase(
        baseTestInput(
          token0,
          token1,
          [walletTrader1, walletTrader2],
          [walletTrader3, walletTrader4],
        ),
      );

      await fundUniswap(testCase, walletDeployer, uniswapPair);
      await setupOrders(
        testCase.sellOrdersToken0.concat(testCase.sellOrdersToken1),
        batcher,
      );

      const encodedOrdersToken0 = testCase.getSellOrdersToken0Encoded();
      const encodedOrdersToken1 = testCase.getSellOrdersToken1Encoded();

      const lastByte = encodedOrdersToken0.readInt8(
        encodedOrdersToken0.length - 1,
      );
      const encodedOrdersLength = encodedOrdersToken0.length;
      expect(encodedOrdersLength).to.be.greaterThan(0);
      const replacementByte = lastByte + 1; // no need to wrap, it's done by fill
      encodedOrdersToken0.fill(
        replacementByte,
        encodedOrdersToken0.length - 1,
        encodedOrdersToken0.length,
      );

      await expect(
        batcher.batchTrade(encodedOrdersToken0, encodedOrdersToken1, {
          gasLimit: 6000000,
        }),
      ).to.be.revertedWith("invalid_signature");
    });

    it("rejects encoded order with not enough bytes", async () => {
      const testCase = generateTestCase(
        baseTestInput(
          token0,
          token1,
          [walletTrader1, walletTrader2],
          [walletTrader3, walletTrader4],
        ),
      );

      await fundUniswap(testCase, walletDeployer, uniswapPair);
      await setupOrders(
        testCase.sellOrdersToken0.concat(testCase.sellOrdersToken1),
        batcher,
      );

      let encodedOrdersToken0 = testCase.getSellOrdersToken0Encoded();
      const encodedOrdersToken1 = testCase.getSellOrdersToken1Encoded();

      encodedOrdersToken0 = encodedOrdersToken0.slice(
        0,
        encodedOrdersToken0.length - 1,
      );

      await expect(
        batcher.batchTrade(encodedOrdersToken0, encodedOrdersToken1, {
          gasLimit: 6000000,
        }),
      ).to.be.revertedWith("malformed encoded orders");
    });
  });
});
