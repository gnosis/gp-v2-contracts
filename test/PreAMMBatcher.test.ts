import ERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import { expect, assert } from "chai";
import { Contract, BigNumber } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  Order,
  DOMAIN_SEPARATOR,
  SmartContractOrder,
} from "../src/js/orders.spec";

import { indefiniteOrder } from "./resources/orderCreation";
import { baseTestInput } from "./resources/testExamples";

describe("PreAMMBatcher: Unit Tests", () => {
  const [
    walletDeployer,
    traderWallet1,
    traderWallet2,
  ] = waffle.provider.getWallets();

  let batcher: Contract;
  let batchTester: Contract;
  let token0: Contract;
  let token1: Contract;
  let uniswapPair: Contract;
  let uniswapFactory: Contract;
  let uniswapPairAddress: string;

  const initialUniswapFundingOfToken0 = ethers.utils.parseEther("10");
  const initialUniswapFundingOfToken1 = ethers.utils.parseEther("10");

  const mockRelevantTokenDataForBatchTrade = async (
    sellOrder1: Order,
    sellOrder2: Order,
  ): Promise<void> => {
    // todo: mock actual right information
    // mock un-relevant data to make batchTrade call pass
    await token0.mock.transferFrom.returns(true);
    await token1.mock.transferFrom.returns(true);
    await token0.mock.transfer.returns(true);
    await token1.mock.transfer.returns(true);
    await token0.mock.allowance
      .withArgs(sellOrder1.wallet.address, batcher.address)
      .returns(sellOrder1.sellAmount.toString());
    await token1.mock.allowance
      .withArgs(sellOrder2.wallet.address, batcher.address)
      .returns(sellOrder2.sellAmount.toString());
    await token0.mock.balanceOf
      .withArgs(sellOrder1.wallet.address)
      .returns(sellOrder1.sellAmount.toString());
    await token1.mock.balanceOf
      .withArgs(sellOrder2.wallet.address)
      .returns(sellOrder2.sellAmount.toString());
    await token0.mock.balanceOf.withArgs(batcher.address).returns("1");
    await token1.mock.balanceOf.withArgs(batcher.address).returns("1");
    await token0.mock.balanceOf
      .withArgs(uniswapPair.address)
      .returns(
        initialUniswapFundingOfToken0.add(sellOrder1.sellAmount).toString(),
      );
    await token1.mock.balanceOf
      .withArgs(uniswapPair.address)
      .returns(initialUniswapFundingOfToken1);
  };

  beforeEach(async () => {
    const PreAMMBatcher = await ethers.getContractFactory("PreAMMBatcher");
    const PreAMMBatcherTestInterface = await ethers.getContractFactory(
      "PreAMMBatcherTestInterface",
    );

    // deploy all relevant contracts and setup the uniswap pool
    token0 = await waffle.deployMockContract(walletDeployer, ERC20.abi);
    token1 = await waffle.deployMockContract(walletDeployer, ERC20.abi);
    uniswapFactory = await waffle.deployContract(
      walletDeployer,
      UniswapV2Factory,
      [walletDeployer.address],
    );
    await uniswapFactory.createPair(token0.address, token1.address, {
      gasLimit: 6000000,
    });
    uniswapPairAddress = await uniswapFactory.getPair(
      token0.address,
      token1.address,
    );
    uniswapPair = await waffle.deployContract(walletDeployer, UniswapV2Pair);
    uniswapPair = await uniswapPair.attach(uniswapPairAddress);
    batcher = await PreAMMBatcher.deploy(uniswapFactory.address);
    batchTester = await PreAMMBatcherTestInterface.deploy(
      uniswapFactory.address,
    );

    await token0.mock.balanceOf
      .withArgs(uniswapPair.address)
      .returns(initialUniswapFundingOfToken0);
    await token1.mock.balanceOf
      .withArgs(uniswapPair.address)
      .returns(initialUniswapFundingOfToken1);

    await uniswapPair.mint(walletDeployer.address, { gasLimit: 500000 });
    expect((await uniswapPair.getReserves())[0]).to.equal(
      initialUniswapFundingOfToken0,
    );
  });

  it("DOMAIN_SEPARATOR is correct", async () => {
    expect(await batcher.DOMAIN_SEPARATOR()).to.equal(DOMAIN_SEPARATOR);
  });

  describe("inverse()", () => {
    it("runs as expected in on generic fraction", async () => {
      const result = await batchTester.inverseTest({
        numerator: 1,
        denominator: 2,
      });
      assert.equal(result.toString(), "2,1");
    });

    it("inverts fraction with zero numerator", async () => {
      const result = await batchTester.inverseTest({
        numerator: 0,
        denominator: 2,
      });
      assert.equal(result.toString(), "2,0");
    });

    it("inverts fraction with zero denominator", async () => {
      const result = await batchTester.inverseTest({
        numerator: 1,
        denominator: 0,
      });
      assert.equal(result.toString(), "0,1");
    });
  });

  describe("orderChecks()", () => {
    describe("order validity period", () => {
      it("succeeds if order is within validity period", async () => {
        const testCaseInput = baseTestInput(
          token0,
          token1,
          [traderWallet1],
          [traderWallet2],
        );
        const now = (await waffle.provider.getBlock("latest")).timestamp;
        testCaseInput.sellOrdersToken0[0].validFrom = BigNumber.from(now - 60);
        testCaseInput.sellOrdersToken0[0].validUntil = BigNumber.from(now + 60);
        testCaseInput.sellOrdersToken1[0].validFrom = BigNumber.from(now - 60);
        testCaseInput.sellOrdersToken1[0].validUntil = BigNumber.from(now + 60);

        await expect(
          batchTester.orderChecksTest(
            [testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
            [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()],
            { gasLimit: 6000000 },
          ),
        ).to.not.be.reverted;
      });

      it("fails if sell order for token 0 is expired", async () => {
        const testCaseInput = baseTestInput(
          token0,
          token1,
          [traderWallet1],
          [traderWallet2],
        );
        const now = (await waffle.provider.getBlock("latest")).timestamp;
        testCaseInput.sellOrdersToken0[0].validUntil = BigNumber.from(now - 60);

        await expect(
          batchTester.orderChecksTest(
            [testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
            [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()],
            { gasLimit: 6000000 },
          ),
        ).to.be.revertedWith("token0 order not currently valid");
      });

      it("fails if sell order for token 1 is expired", async () => {
        const testCaseInput = baseTestInput(
          token0,
          token1,
          [traderWallet1],
          [traderWallet2],
        );
        const now = (await waffle.provider.getBlock("latest")).timestamp;
        testCaseInput.sellOrdersToken1[0].validUntil = BigNumber.from(now - 60);

        await expect(
          batchTester.orderChecksTest(
            [testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
            [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()],
            { gasLimit: 6000000 },
          ),
        ).to.be.revertedWith("token1 order not currently valid");
      });

      it("fails if sell order for token 0 is not valid yet", async () => {
        const testCaseInput = baseTestInput(
          token0,
          token1,
          [traderWallet1],
          [traderWallet2],
        );
        const now = (await waffle.provider.getBlock("latest")).timestamp;
        testCaseInput.sellOrdersToken0[0].validFrom = BigNumber.from(now + 60);

        await expect(
          batchTester.orderChecksTest(
            [testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
            [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()],
            { gasLimit: 6000000 },
          ),
        ).to.be.revertedWith("token0 order not currently valid");
      });

      it("fails if sell order for token 1 is not yet valid", async () => {
        const testCaseInput = baseTestInput(
          token0,
          token1,
          [traderWallet1],
          [traderWallet2],
        );
        const now = (await waffle.provider.getBlock("latest")).timestamp;
        testCaseInput.sellOrdersToken1[0].validFrom = BigNumber.from(now + 60);

        await expect(
          batchTester.orderChecksTest(
            [testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
            [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()],
            { gasLimit: 6000000 },
          ),
        ).to.be.revertedWith("token1 order not currently valid");
      });
    });

    it("runs as expected in generic setting", async () => {
      const testCaseInput = baseTestInput(
        token0,
        token1,
        [traderWallet1],
        [traderWallet2],
      );

      await expect(
        batchTester.orderChecksTest(
          [testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
          [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()],
          { gasLimit: 6000000 },
        ),
      ).to.not.be.reverted;
    });

    it("detects non matching orders", async () => {
      const testCaseInput = baseTestInput(
        token0,
        token1,
        [traderWallet1],
        [traderWallet2],
      );
      testCaseInput.sellOrdersToken1[0].sellToken = token0;

      await expect(
        batchTester.orderChecksTest(
          [testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
          [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()],
          { gasLimit: 6000000 },
        ),
      ).to.be.revertedWith("invalid token1 order sell token");
    });
  });

  describe("receiveTradeAmounts()", () => {
    it("reverts if transferFrom fails for token0", async () => {
      const testCaseInput = baseTestInput(
        token0,
        token1,
        [traderWallet1],
        [traderWallet2],
      );

      await mockRelevantTokenDataForBatchTrade(
        testCaseInput.sellOrdersToken0[0],
        testCaseInput.sellOrdersToken1[0],
      );
      await token0.mock.transferFrom.returns(false);
      await expect(
        batcher.batchTrade(
          testCaseInput.sellOrdersToken0[0].encode(),
          testCaseInput.sellOrdersToken1[0].encode(),
          { gasLimit: 6000000 },
        ),
      ).to.be.revertedWith("order transfer failed");
    });

    it("transfers correct amount of token0", async () => {
      const testCaseInput = baseTestInput(
        token0,
        token1,
        [traderWallet1],
        [traderWallet2],
      );

      await mockRelevantTokenDataForBatchTrade(
        testCaseInput.sellOrdersToken0[0],
        testCaseInput.sellOrdersToken1[0],
      );

      await token0.mock.transferFrom.reverts();
      await token0.mock.transferFrom
        .withArgs(
          traderWallet1.address,
          batcher.address,
          testCaseInput.sellOrdersToken0[0].sellAmount,
        )
        .returns(true);
      await token1.mock.transferFrom.returns(true);

      await expect(
        batcher.batchTrade(
          testCaseInput.sellOrdersToken0[0].encode(),
          testCaseInput.sellOrdersToken1[0].encode(),
          { gasLimit: 6000000 },
        ),
      ).to.not.be.reverted;
    });

    it("reverts if transferFrom fails for token1", async () => {
      const testCaseInput = baseTestInput(
        token0,
        token1,
        [traderWallet1],
        [traderWallet2],
      );

      await mockRelevantTokenDataForBatchTrade(
        testCaseInput.sellOrdersToken0[0],
        testCaseInput.sellOrdersToken1[0],
      );

      await token0.mock.transferFrom.returns(true);
      await token1.mock.transferFrom.returns(false);
      await expect(
        batcher.batchTrade(
          testCaseInput.sellOrdersToken0[0].encode(),
          testCaseInput.sellOrdersToken1[0].encode(),
          { gasLimit: 6000000 },
        ),
      ).to.be.revertedWith("order transfer failed");
    });

    it("transfers correct amount of token1", async () => {
      const testCaseInput = baseTestInput(
        token0,
        token1,
        [traderWallet1],
        [traderWallet2],
      );
      await mockRelevantTokenDataForBatchTrade(
        testCaseInput.sellOrdersToken0[0],
        testCaseInput.sellOrdersToken1[0],
      );

      await token0.mock.transferFrom.returns(true);
      await token1.mock.transferFrom.reverts();
      await token1.mock.transferFrom
        .withArgs(
          traderWallet2.address,
          batcher.address,
          testCaseInput.sellOrdersToken1[0].sellAmount,
        )
        .returns(true);

      await expect(
        batcher.batchTrade(
          testCaseInput.sellOrdersToken0[0].encode(),
          testCaseInput.sellOrdersToken1[0].encode(),
          { gasLimit: 6000000 },
        ),
      ).to.not.be.reverted;
    });
  });

  describe("isSortedByLimitPrice()", async () => {
    const ASCENDING = 0;
    const DESCENDING = 1;

    it("returns expected values for generic sorted order set", async () => {
      const sortedOrders = [
        indefiniteOrder(1, 1, token0, token1, traderWallet1, 1),
        indefiniteOrder(1, 2, token0, token1, traderWallet1, 2),
        indefiniteOrder(1, 3, token0, token1, traderWallet1, 3),
      ];

      expect(
        await batchTester.isSortedByLimitPriceTest(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          ASCENDING,
        ),
      ).to.be.equal(true, "sorted orders should be ascending.");
      expect(
        await batchTester.isSortedByLimitPriceTest(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          DESCENDING,
        ),
      ).to.be.equal(false, "Sorted orders should not be descending");

      // Reverse the sorted list so it is descending and assert converse
      sortedOrders.reverse();
      expect(
        await batchTester.isSortedByLimitPriceTest(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          ASCENDING,
        ),
      ).to.be.equal(false, "Reversed sorted orders should not be ascending.");
      expect(
        await batchTester.isSortedByLimitPriceTest(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          DESCENDING,
        ),
      ).to.be.equal(true, "Reversed sorted orders should be descending.");
    });

    it("returns expected values for same two orders", async () => {
      const sortedOrders = [
        indefiniteOrder(1, 1, token0, token1, traderWallet1, 1),
        indefiniteOrder(1, 1, token0, token1, traderWallet1, 2),
      ];
      expect(
        await batchTester.isSortedByLimitPriceTest(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          ASCENDING,
        ),
      ).to.be.equal(true, "Failed ascending");
      expect(
        await batchTester.isSortedByLimitPriceTest(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          DESCENDING,
        ),
      ).to.be.equal(true, "Failed Descending");
    });

    it("returns expected values for generic unsorted set of orders", async () => {
      const unsortedOrders = [
        indefiniteOrder(1, 2, token0, token1, traderWallet1, 1),
        indefiniteOrder(1, 1, token0, token1, traderWallet1, 2),
        indefiniteOrder(1, 3, token0, token1, traderWallet1, 3),
      ];
      expect(
        await batchTester.isSortedByLimitPriceTest(
          unsortedOrders.map((x) => x.getSmartContractOrder()),
          ASCENDING,
        ),
      ).to.be.equal(false);
      expect(
        await batchTester.isSortedByLimitPriceTest(
          unsortedOrders.map((x) => x.getSmartContractOrder()),
          DESCENDING,
        ),
      ).to.be.equal(false);
    });

    it("returns expected values for empty set of orders", async () => {
      // Empty orderset is sorted.
      const emptyOrders: Order[] = [];
      expect(
        await batchTester.isSortedByLimitPriceTest(
          emptyOrders.map((x) => x.getSmartContractOrder()),
          ASCENDING,
        ),
      ).to.be.equal(true);
      expect(
        await batchTester.isSortedByLimitPriceTest(
          emptyOrders.map((x) => x.getSmartContractOrder()),
          DESCENDING,
        ),
      ).to.be.equal(true);
    });

    it("returns expected values for singleton order set", async () => {
      // Single Orderset is vacuously sorted
      const singleOrder = [
        indefiniteOrder(1, 1, token0, token1, traderWallet1, 1),
      ];
      expect(
        await batchTester.isSortedByLimitPriceTest(
          singleOrder.map((x) => x.getSmartContractOrder()),
          ASCENDING,
        ),
      ).to.be.equal(true);
      expect(
        await batchTester.isSortedByLimitPriceTest(
          singleOrder.map((x) => x.getSmartContractOrder()),
          DESCENDING,
        ),
      ).to.be.equal(true);
    });

    it("reverts with overflowing artithmetic", async () => {
      const maxUint = ethers.constants.MaxUint256;

      const overflowingPair = [
        indefiniteOrder(2, maxUint, token0, token1, traderWallet1, 1),
        indefiniteOrder(1, maxUint, token0, token1, traderWallet1, 1),
      ];
      await expect(
        batchTester.isSortedByLimitPriceTest(
          overflowingPair.map((x) => x.getSmartContractOrder()),
          ASCENDING,
        ),
      ).to.be.revertedWith("SafeMath: multiplication overflow");
      await expect(
        batchTester.isSortedByLimitPriceTest(
          overflowingPair.map((x) => x.getSmartContractOrder()),
          DESCENDING,
        ),
      ).to.be.revertedWith("SafeMath: multiplication overflow");

      overflowingPair.reverse();
      await expect(
        batchTester.isSortedByLimitPriceTest(
          overflowingPair.map((x) => x.getSmartContractOrder()),
          ASCENDING,
        ),
      ).to.be.revertedWith("SafeMath: multiplication overflow");
      await expect(
        batchTester.isSortedByLimitPriceTest(
          overflowingPair.map((x) => x.getSmartContractOrder()),
          DESCENDING,
        ),
      ).to.be.revertedWith("SafeMath: multiplication overflow");
    });
  });

  describe("removeLastElement()", () => {
    it("returns list of orders with top removed for generic list", async () => {
      const orders = [
        indefiniteOrder(1, 1, token0, token1, traderWallet1, 1),
        indefiniteOrder(1, 2, token0, token1, traderWallet1, 2),
        indefiniteOrder(1, 3, token0, token1, traderWallet1, 3),
      ].map((x) => x.getSmartContractOrder());

      const expectedResult = orders.slice(0, orders.length - 1);
      const result: SmartContractOrder[] = await batchTester.removeLastElementTest(
        orders,
      );

      assert.equal(
        result.length,
        expectedResult.length,
        "Resulting list length is incorrect",
      );

      for (let i = 0; i < result.length; i++) {
        assert(
          result[i].sellAmount.eq(expectedResult[i].sellAmount),
          `Resulting sellAmount disagrees at index ${i}`,
        );
        assert(
          result[i].buyAmount.eq(expectedResult[i].buyAmount),
          `Resulting buyAmount disagrees at index ${i}`,
        );
        assert.equal(
          result[i].sellToken,
          expectedResult[i].sellToken,
          `Resulting sellToken disagrees at index ${i}`,
        );
        assert.equal(
          result[i].buyToken,
          expectedResult[i].buyToken,
          `Resulting buyToken disagrees at index ${i}`,
        );
        assert.equal(
          result[i].owner,
          expectedResult[i].owner,
          `Resulting owner disagrees at index ${i}`,
        );
        assert.equal(
          result[i].nonce,
          expectedResult[i].nonce,
          `Resulting nonce disagrees at index ${i}`,
        );
      }
    });

    it("reverts on empty list of orders", async () => {
      const orders: Order[] = [];
      await expect(
        batchTester.removeLastElementTest(
          orders.map((x) => x.getSmartContractOrder()),
        ),
      ).to.be.revertedWith("Can't remove from empty list");
    });
  });
});
