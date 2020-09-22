import { use, expect } from "chai";
import { Contract, utils } from "ethers";
import {
  deployContract,
  deployMockContract,
  MockProvider,
  solidity,
} from "ethereum-waffle";
import PreAMMBatcher from "../build/PreAMMBatcher.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory";

import ERC20 from "../build/ERC20Mintable.json";
import { Order, DOMAIN_SEPARATOR } from "../src/js/orders.spec";
import { baseTestInput } from "./resources/testExamples";

use(solidity);

describe("PreAMMBatcher: Unit Tests", () => {
  const [
    walletDeployer,
    traderWallet1,
    traderWallet2,
  ] = new MockProvider().getWallets();
  let batcher: Contract;
  let token0: Contract;
  let token1: Contract;
  let uniswapPair: Contract;
  let uniswapFactory: Contract;
  let uniswapPairAddress: string;
  const initialUniswapFundingOfToken0 = utils.parseEther("10");
  const initialUniswapFundingOfToken1 = utils.parseEther("10");

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
    // deploy all relevant contracts and setup the uniswap pool
    token0 = await deployMockContract(walletDeployer, ERC20.abi);
    token1 = await deployMockContract(walletDeployer, ERC20.abi);
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
  describe("orderChecks()", () => {
    it("runs as expected in generic setting", async () => {
      const testCaseInput = baseTestInput(
        token0,
        token1,
        [traderWallet1],
        [traderWallet2],
      );

      await batcher.orderChecks(
        [testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
        [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()],
        { gasLimit: 6000000 },
      );
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
        batcher.orderChecks(
          [testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
          [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()],
          { gasLimit: 6000000 },
        ),
      ).to.revertedWith("sellOrderToken1 are not compatible in sellToken");
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
      ).to.be.revertedWith("unsuccessful transferFrom for order");
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

      await batcher.batchTrade(
        testCaseInput.sellOrdersToken0[0].encode(),
        testCaseInput.sellOrdersToken1[0].encode(),
        { gasLimit: 6000000 },
      );
      expect("transferFrom").to.be.calledOnContractWith(token0, [
        traderWallet1.address,
        batcher.address,
        testCaseInput.sellOrdersToken0[0].sellAmount.toString(),
      ]);
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
      ).to.be.revertedWith("unsuccessful transferFrom for order");
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
      await batcher.batchTrade(
        testCaseInput.sellOrdersToken0[0].encode(),
        testCaseInput.sellOrdersToken1[0].encode(),
        { gasLimit: 6000000 },
      );
      expect("transferFrom").to.be.calledOnContractWith(token1, [
        traderWallet2.address,
        batcher.address,
        testCaseInput.sellOrdersToken1[0].sellAmount.toString(),
      ]);
    });
  });
  describe("isSorted()", async () => {
    it("returns expected values for generic sorted order set", async () => {
      const sortedOrders = [
        new Order(1, 1, token0, token1, traderWallet1, 1),
        new Order(1, 2, token0, token1, traderWallet1, 2),
        new Order(1, 3, token0, token1, traderWallet1, 3),
      ];

      expect(
        await batcher.isSorted(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          false,
        ),
      ).to.be.equal(true);
      expect(
        await batcher.isSorted(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          true,
        ),
      ).to.be.equal(false);

      // Reverse the sorted list so it is descending and assert converse
      sortedOrders.reverse();
      expect(
        await batcher.isSorted(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          false,
        ),
      ).to.be.equal(false);
      expect(
        await batcher.isSorted(
          sortedOrders.map((x) => x.getSmartContractOrder()),
          true,
        ),
      ).to.be.equal(true);
    });

    it("returns expected values for generic unsorted set of orders", async () => {
      const unsortedOrders = [
        new Order(1, 2, token0, token1, traderWallet1, 1),
        new Order(1, 1, token0, token1, traderWallet1, 2),
        new Order(1, 3, token0, token1, traderWallet1, 3),
      ];
      expect(
        await batcher.isSorted(
          unsortedOrders.map((x) => x.getSmartContractOrder()),
          false,
        ),
      ).to.be.equal(false);
      expect(
        await batcher.isSorted(
          unsortedOrders.map((x) => x.getSmartContractOrder()),
          true,
        ),
      ).to.be.equal(false);
    });
    it("returns expected values for empty set of orders", async () => {
      // Empty orderset is sorted.
      const emptyOrders: Order[] = [];
      expect(
        await batcher.isSorted(
          emptyOrders.map((x) => x.getSmartContractOrder()),
          false,
        ),
      ).to.be.equal(true);
      expect(
        await batcher.isSorted(
          emptyOrders.map((x) => x.getSmartContractOrder()),
          true,
        ),
      ).to.be.equal(true);
    });
    it("returns expected values for singleton order set", async () => {
      // Single Orderset is vacuously sorted
      const singleOrder = [new Order(1, 1, token0, token1, traderWallet1, 1)];
      expect(
        await batcher.isSorted(
          singleOrder.map((x) => x.getSmartContractOrder()),
          false,
        ),
      ).to.be.equal(true);
      expect(
        await batcher.isSorted(
          singleOrder.map((x) => x.getSmartContractOrder()),
          true,
        ),
      ).to.be.equal(true);
    });
  });
});
