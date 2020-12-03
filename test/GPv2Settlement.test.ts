import { expect } from "chai";
import { BigNumber, Contract, TypedDataDomain } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import {
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  allowanceManagerAddress,
  domain,
} from "../src/ts";

interface Transfer {
  owner: string;
  token: string;
  amount: BigNumber;
}

function parseTransfers(transfers: unknown[][][]): [Transfer[], Transfer[]] {
  const parseTransfer = (transfer: unknown[]) => ({
    owner: transfer[0] as string,
    token: transfer[1] as string,
    amount: transfer[2] as BigNumber,
  });

  return [transfers[0].map(parseTransfer), transfers[1].map(parseTransfer)];
}

import { builtAndDeployedMetadataCoincide } from "./bytecode";

describe("GPv2Settlement", () => {
  const [deployer, owner, solver, ...traders] = waffle.provider.getWallets();

  let authenticator: Contract;
  let settlement: Contract;
  let testDomain: TypedDataDomain;

  beforeEach(async () => {
    const GPv2AllowListAuthentication = await ethers.getContractFactory(
      "GPv2AllowListAuthentication",
      deployer,
    );
    authenticator = await GPv2AllowListAuthentication.deploy(owner.address);

    const GPv2Settlement = await ethers.getContractFactory(
      "GPv2SettlementTestInterface",
      deployer,
    );
    settlement = await GPv2Settlement.deploy(authenticator.address);

    const { chainId } = await ethers.provider.getNetwork();
    testDomain = domain(chainId, settlement.address);
  });

  describe("domainSeparator", () => {
    it("should have an EIP-712 domain separator", async () => {
      expect(await settlement.domainSeparatorTest()).to.equal(
        ethers.utils._TypedDataEncoder.hashDomain(testDomain),
      );
    });

    it("should have a different replay protection for each deployment", async () => {
      const GPv2Settlement = await ethers.getContractFactory(
        "GPv2SettlementTestInterface",
        deployer,
      );
      const settlement2 = await GPv2Settlement.deploy(authenticator.address);

      expect(await settlement.domainSeparatorTest()).to.not.equal(
        await settlement2.domainSeparatorTest(),
      );
    });
  });

  describe("allowanceManager", () => {
    it("should deploy an allowance manager", async () => {
      const deployedAllowanceManager = await settlement.allowanceManagerTest();
      expect(
        await builtAndDeployedMetadataCoincide(
          deployedAllowanceManager,
          "GPv2AllowanceManager",
        ),
      ).to.be.true;
    });

    it("should result in a deterministic address", async () => {
      expect(await settlement.allowanceManagerTest()).to.equal(
        allowanceManagerAddress(settlement.address),
      );
    });

    it("should have the settlement contract as the recipient", async () => {
      const ADDRESS_BYTE_LENGTH = 20;

      // NOTE: In order to avoid having the allowance manager add a public
      // accessor for its recipient just for testing, which would add minor
      // costs at both deployment time and runtime, just read the contract code
      // to get the immutable value.
      const buildInfo = await artifacts.getBuildInfo(
        "src/contracts/GPv2AllowanceManager.sol:GPv2AllowanceManager",
      );
      if (buildInfo === undefined) {
        throw new Error("missing GPv2AllowanceManager build info");
      }

      const [[recipientImmutableReference]] = Object.values(
        buildInfo.output.contracts["src/contracts/GPv2AllowanceManager.sol"]
          .GPv2AllowanceManager.evm.deployedBytecode.immutableReferences || {},
      );

      const deployedAllowanceManager = await settlement.allowanceManagerTest();
      const code = await ethers.provider.send("eth_getCode", [
        deployedAllowanceManager,
        "latest",
      ]);
      const recipient = ethers.utils.hexlify(
        ethers.utils
          .arrayify(code)
          .subarray(recipientImmutableReference.start)
          .subarray(recipientImmutableReference.length - ADDRESS_BYTE_LENGTH)
          .slice(0, ADDRESS_BYTE_LENGTH),
      );

      expect(ethers.utils.getAddress(recipient)).to.equal(settlement.address);
    });
  });

  describe("settle", () => {
    it("rejects transactions from non-solvers", async () => {
      await expect(settlement.settle([], [], [], [], [])).to.be.revertedWith(
        "GPv2: not a solver",
      );
    });

    it("accepts transactions from solvers", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      // TODO - this will have to be changed when other constraints become active
      // and when settle function no longer reverts.
      await expect(
        settlement.connect(solver).settle([], [], [], [], []),
      ).revertedWith("Final: not yet implemented");
    });
  });

  describe("computeTradeExecutions", () => {
    const tokens = [`0x${"11".repeat(20)}`, `0x${"22".repeat(20)}`];
    const prices = {
      [tokens[0]]: 1,
      [tokens[1]]: 2,
    };
    const partialOrder = {
      sellToken: tokens[0],
      buyToken: tokens[1],
      sellAmount: ethers.utils.parseEther("42"),
      buyAmount: ethers.utils.parseEther("13.37"),
      validTo: 0xffffffff,
      appData: 0,
      feeAmount: ethers.constants.Zero,
    };

    it("should compute in/out transfers for multiple trades", async () => {
      const tradeCount = 10;
      const encoder = new SettlementEncoder(testDomain);
      for (let i = 0; i < tradeCount; i++) {
        await encoder.signEncodeTrade(
          {
            ...partialOrder,
            kind: OrderKind.BUY,
            partiallyFillable: true,
          },
          ethers.utils.parseEther("0.7734"),
          traders[0],
          SigningScheme.TYPED_DATA,
        );
      }

      const [inTransfers, outTransfers] = parseTransfers(
        await settlement.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.encodedTrades,
        ),
      );

      expect(inTransfers.length).to.equal(tradeCount);
      expect(outTransfers.length).to.equal(tradeCount);
    });

    describe("Order Variations", async () => {
      const { sellAmount, buyAmount } = partialOrder;
      const executedAmount = ethers.utils.parseEther("10.0");
      const computeTradeExecutionVariant = async (
        kind: OrderKind,
        partiallyFillable: boolean,
      ) => {
        const encoder = new SettlementEncoder(testDomain);
        await encoder.signEncodeTrade(
          {
            ...partialOrder,
            kind,
            partiallyFillable,
          },
          executedAmount,
          traders[0],
          SigningScheme.TYPED_DATA,
        );

        const [
          [{ amount: executedSellAmount }],
          [{ amount: executedBuyAmount }],
        ] = parseTransfers(
          await settlement.computeTradeExecutionsTest(
            encoder.tokens,
            encoder.clearingPrices(prices),
            encoder.encodedTrades,
          ),
        );

        const [sellPrice, buyPrice] = [
          prices[partialOrder.sellToken],
          prices[partialOrder.buyToken],
        ];

        return { executedSellAmount, sellPrice, executedBuyAmount, buyPrice };
      };

      it("should compute amounts for fill-or-kill sell orders", async () => {
        const {
          executedSellAmount,
          sellPrice,
          executedBuyAmount,
          buyPrice,
        } = await computeTradeExecutionVariant(OrderKind.SELL, false);

        expect(executedSellAmount).to.deep.equal(sellAmount);
        expect(executedBuyAmount).to.deep.equal(
          sellAmount.mul(sellPrice).div(buyPrice),
        );
      });

      it("should respect the limit price for fill-or-kill sell orders", async () => {
        const { executedBuyAmount } = await computeTradeExecutionVariant(
          OrderKind.SELL,
          false,
        );

        expect(executedBuyAmount.gt(buyAmount)).to.be.true;
      });

      it("should compute amounts for fill-or-kill buy orders", async () => {
        const {
          executedSellAmount,
          sellPrice,
          executedBuyAmount,
          buyPrice,
        } = await computeTradeExecutionVariant(OrderKind.BUY, false);

        expect(executedSellAmount).to.deep.equal(
          buyAmount.mul(buyPrice).div(sellPrice),
        );
        expect(executedBuyAmount).to.deep.equal(buyAmount);
      });

      it("should respect the limit price for fill-or-kill buy orders", async () => {
        const { executedSellAmount } = await computeTradeExecutionVariant(
          OrderKind.BUY,
          false,
        );

        expect(executedSellAmount.lt(sellAmount)).to.be.true;
      });

      it("should compute amounts for partially fillable sell orders", async () => {
        const {
          executedSellAmount,
          sellPrice,
          executedBuyAmount,
          buyPrice,
        } = await computeTradeExecutionVariant(OrderKind.SELL, true);

        expect(executedSellAmount).to.deep.equal(executedAmount);
        expect(executedBuyAmount).to.deep.equal(
          executedAmount.mul(sellPrice).div(buyPrice),
        );
      });

      it("should respect the limit price for partially fillable sell orders", async () => {
        const {
          executedSellAmount,
          executedBuyAmount,
        } = await computeTradeExecutionVariant(OrderKind.SELL, true);

        expect(
          executedBuyAmount
            .mul(sellAmount)
            .gt(executedSellAmount.mul(buyAmount)),
        ).to.be.true;
      });

      it("should compute amounts for partially fillable buy orders", async () => {
        const {
          executedSellAmount,
          sellPrice,
          executedBuyAmount,
          buyPrice,
        } = await computeTradeExecutionVariant(OrderKind.BUY, true);

        expect(executedSellAmount).to.deep.equal(
          executedAmount.mul(buyPrice).div(sellPrice),
        );
        expect(executedBuyAmount).to.deep.equal(executedAmount);
      });

      it("should respect the limit price for partially fillable buy orders", async () => {
        const {
          executedSellAmount,
          executedBuyAmount,
        } = await computeTradeExecutionVariant(OrderKind.BUY, true);

        expect(
          executedBuyAmount
            .mul(sellAmount)
            .gt(executedSellAmount.mul(buyAmount)),
        ).to.be.true;
      });
    });

    it("should ignore the executed trade amount for fill-or-kill orders", async () => {
      const order = {
        ...partialOrder,
        kind: OrderKind.BUY,
        partiallyFillable: false,
      };

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        order,
        0,
        traders[0],
        SigningScheme.TYPED_DATA,
      );
      await encoder.signEncodeTrade(
        order,
        ethers.utils.parseEther("1.0"),
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const [inTransfers, outTransfers] = parseTransfers(
        await settlement.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.encodedTrades,
        ),
      );

      expect(inTransfers[0]).to.deep.equal(inTransfers[1]);
      expect(outTransfers[0]).to.deep.equal(outTransfers[1]);
    });

    it("should add the fee to the in transfer", async () => {
      const feeAmount = ethers.utils.parseEther("10");
      const order = {
        ...partialOrder,
        feeAmount,
        kind: OrderKind.SELL,
        partiallyFillable: false,
      };

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        order,
        0,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const [[inTransfer]] = parseTransfers(
        await settlement.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.encodedTrades,
        ),
      );

      expect(inTransfer.amount).to.deep.equal(order.sellAmount.add(feeAmount));
    });
  });

  describe("computeTradeExecution", () => {
    it("should not allocate additional memory", async () => {
      expect(await settlement.computeTradeExecutionMemoryTest()).to.deep.equal(
        ethers.constants.Zero,
      );
    });
  });
});
