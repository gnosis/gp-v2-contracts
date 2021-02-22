import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import {
  BigNumber,
  BigNumberish,
  Contract,
  ContractReceipt,
  Event,
} from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import {
  EncodedSingleTradeSettlement,
  Interaction,
  InteractionLike,
  InteractionStage,
  Order,
  OrderFlags,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TradeExecution,
  TypedDataDomain,
  computeOrderUid,
  domain,
  normalizeInteractions,
  packOrderUidParams,
  Transfer,
  Trade,
} from "../src/ts";

import { builtAndDeployedMetadataCoincide } from "./bytecode";
import {
  encodeFilledAmountRefunds,
  encodeOutTransfers,
  encodePreSignatureRefunds,
} from "./encoding";

function toNumberLossy(value: BigNumber): number {
  // NOTE: BigNumber throws an exception when if is outside the range of
  // representable integers for JavaScript's double precision floating point
  // numbers. For some tests, that is OK, so perform a lossy conversion.
  return parseInt(value.toString());
}

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
    authenticator = await GPv2AllowListAuthentication.deploy();
    await authenticator.initializeManager(owner.address);

    const GPv2Settlement = await ethers.getContractFactory(
      "GPv2SettlementTestInterface",
      deployer,
    );
    settlement = await GPv2Settlement.deploy(authenticator.address);

    const { chainId } = await ethers.provider.getNetwork();
    testDomain = domain(chainId, settlement.address);
  });

  describe("authenticator", () => {
    it("should be set to the authenticator the contract was initialized with", async () => {
      expect(await settlement.authenticator()).to.equal(authenticator.address);
    });
  });

  describe("allowanceManager", () => {
    it("should deploy an allowance manager", async () => {
      const deployedAllowanceManager = await settlement.allowanceManager();
      expect(
        await builtAndDeployedMetadataCoincide(
          deployedAllowanceManager,
          "GPv2AllowanceManager",
        ),
      ).to.be.true;
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

      const deployedAllowanceManager = await settlement.allowanceManager();
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

  describe("filledAmount", () => {
    it("is zero for an untouched order", async () => {
      const orderDigest = ethers.constants.HashZero;
      const owner = ethers.constants.AddressZero;
      const validTo = 2 ** 32 - 1;

      expect(
        await settlement.filledAmount(
          packOrderUidParams({ orderDigest, owner, validTo }),
        ),
      ).to.equal(ethers.constants.Zero);
    });
  });

  describe("receive", () => {
    it("allows receiving Ether directly in the settlement contract", async () => {
      await expect(
        traders[0].sendTransaction({
          to: settlement.address,
          value: ethers.utils.parseEther("1.0"),
        }),
      ).to.not.be.reverted;
    });
  });

  describe("settle", () => {
    const empty = new SettlementEncoder(testDomain).encodedSettlement({});

    it("rejects transactions from non-solvers", async () => {
      await expect(settlement.settle(...empty)).to.be.revertedWith(
        "GPv2: not a solver",
      );
    });

    it("rejects reentrancy attempts via interactions", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      const encoder = new SettlementEncoder(testDomain);
      encoder.encodeInteraction({
        target: settlement.address,
        callData: settlement.interface.encodeFunctionData("settle", empty),
      });

      await expect(
        settlement.connect(solver).settle(...encoder.encodedSettlement({})),
      ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });

    it("rejects reentrancy attempt even if settlement contract is registered solver", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      // Add settlement contract address as registered solver
      await authenticator.connect(owner).addSolver(settlement.address);
      const encoder = new SettlementEncoder(testDomain);
      encoder.encodeInteraction({
        target: settlement.address,
        callData: settlement.interface.encodeFunctionData("settle", empty),
      });

      await expect(
        settlement.connect(solver).settle(...encoder.encodedSettlement({})),
      ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });

    it("accepts transactions from solvers", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      await expect(settlement.connect(solver).settle(...empty)).to.not.be
        .reverted;
    });

    it("emits a Settlement event", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      await expect(settlement.connect(solver).settle(...empty))
        .to.emit(settlement, "Settlement")
        .withArgs(solver.address);
    });

    it("executes interactions stages in the correct order", async () => {
      const stageTarget = (stage: InteractionStage): string =>
        ethers.utils.getAddress(
          ethers.utils.hexDataSlice(ethers.utils.keccak256([stage]), 0, 20),
        );

      // NOTE: Extra care is taken that the interactions with the following
      // stages are **not** encoded in execution order.
      const stages = [
        InteractionStage.POST,
        InteractionStage.PRE,
        InteractionStage.INTRA,
      ];

      const encoder = new SettlementEncoder(testDomain);
      for (const stage of stages) {
        encoder.encodeInteraction(
          {
            target: stageTarget(stage),
          },
          stage,
        );
      }

      await authenticator.connect(owner).addSolver(solver.address);
      const tx = await settlement
        .connect(solver)
        .settle(...encoder.encodedSettlement({}));
      const receipt: ContractReceipt = await tx.wait();
      const events = receipt.events || [];

      expect(events.length).to.equal(stages.length + 1);
      expect(events[0].args?.target).to.equal(
        stageTarget(InteractionStage.PRE),
      );
      expect(events[1].args?.target).to.equal(
        stageTarget(InteractionStage.INTRA),
      );
      expect(events[2].args?.target).to.equal(
        stageTarget(InteractionStage.POST),
      );
      expect(events[3].event).to.equal("Settlement");
    });

    it("reverts if encoded interactions has incorrect number of stages", async () => {
      await authenticator.connect(owner).addSolver(solver.address);

      const [tokens, clearingPrices, trades, , encodedOrderRefunds] = empty;
      await expect(
        settlement
          .connect(solver)
          .settle([
            tokens,
            clearingPrices,
            trades,
            ["0x", "0x"],
            encodedOrderRefunds,
          ]),
      ).to.be.reverted;
      await expect(
        settlement
          .connect(solver)
          .settle([
            tokens,
            clearingPrices,
            trades,
            ["0x", "0x", "0x", "0x"],
            encodedOrderRefunds,
          ]),
      ).to.be.reverted;
    });
  });

  describe("settleSingleTrade", () => {
    let buyToken: Contract;

    beforeEach(async () => {
      const BalanceOf = await ethers.getContractFactory("BalanceOf");
      buyToken = await BalanceOf.deploy();
    });

    const emptySingleTradeSettlement = async (
      extraInteraction?: InteractionLike,
    ): Promise<EncodedSingleTradeSettlement> => {
      const uselessOrder = {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: ethers.constants.AddressZero,
        buyToken: buyToken.address,
        sellAmount: 0,
        buyAmount: 0,
        feeAmount: 0,
        validTo: 0xffffffff,
        appData: 0,
      };

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        uselessOrder,
        traders[0],
        SigningScheme.EIP712,
      );

      if (extraInteraction !== undefined) {
        encoder.encodeInteraction(extraInteraction);
      }

      return encoder.encodeSingleTradeSettlement([]);
    };

    it("emits a Settlement event", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      await expect(
        settlement
          .connect(solver)
          .settleSingleTrade(...(await emptySingleTradeSettlement())),
      )
        .to.emit(settlement, "Settlement")
        .withArgs(solver.address);
    });

    it("rejects transactions from non-solvers", async () => {
      await expect(
        settlement.settleSingleTrade(...(await emptySingleTradeSettlement())),
      ).to.be.revertedWith("not a solver");
    });

    it("rejects reentrancy attempts via interactions", async () => {
      await authenticator.connect(owner).addSolver(solver.address);

      await expect(
        settlement.connect(solver).settleSingleTrade(
          ...(await emptySingleTradeSettlement({
            target: settlement.address,
            callData: settlement.interface.encodeFunctionData(
              "settleSingleTrade",
              await emptySingleTradeSettlement(),
            ),
          })),
        ),
      ).to.be.revertedWith("reentrant call");
    });

    it("rejects reentrancy attempts to full settlement function", async () => {
      await authenticator.connect(owner).addSolver(solver.address);

      const emptySettlement = new SettlementEncoder(
        testDomain,
      ).encodedSettlement({});
      await expect(
        settlement.connect(solver).settleSingleTrade(
          ...(await emptySingleTradeSettlement({
            target: settlement.address,
            callData: settlement.interface.encodeFunctionData(
              "settle",
              emptySettlement,
            ),
          })),
        ),
      ).to.be.revertedWith("reentrant call");
    });
  });

  describe("invalidateOrder", () => {
    it("sets filled amount of the caller's order to max uint256", async () => {
      const orderDigest = "0x" + "11".repeat(32);
      const validTo = 2 ** 32 - 1;
      const orderUid = packOrderUidParams({
        orderDigest,
        owner: traders[0].address,
        validTo,
      });

      await settlement.connect(traders[0]).invalidateOrder(orderUid);
      expect(await settlement.filledAmount(orderUid)).to.equal(
        ethers.constants.MaxUint256,
      );
    });

    it("emits an OrderInvalidated event log", async () => {
      const orderUid = packOrderUidParams({
        orderDigest: ethers.constants.HashZero,
        owner: traders[0].address,
        validTo: 0,
      });

      const invalidateOrder = settlement
        .connect(traders[0])
        .invalidateOrder(orderUid);

      await expect(invalidateOrder).to.emit(settlement, "OrderInvalidated");

      const tx = await invalidateOrder;
      const { events } = await tx.wait();

      expect(events[0].args).to.deep.equal([traders[0].address, orderUid]);
    });

    it("fails to invalidate order that is not owned by the caller", async () => {
      const orderDigest = "0x".padEnd(66, "1");
      const validTo = 2 ** 32 - 1;
      const orderUid = packOrderUidParams({
        orderDigest,
        owner: traders[0].address,
        validTo,
      });

      await expect(
        settlement.connect(traders[1]).invalidateOrder(orderUid),
      ).to.be.revertedWith("GPv2: caller does not own order");
    });
  });

  describe("computeTradeExecutions", () => {
    const sellToken = `0x${"11".repeat(20)}`;
    const buyToken = `0x${"22".repeat(20)}`;
    const prices = {
      [sellToken]: 1,
      [buyToken]: 2,
    };
    const partialOrder = {
      sellToken,
      buyToken,
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
          traders[0],
          SigningScheme.EIP712,
          { executedAmount: ethers.utils.parseEther("0.7734") },
        );
      }

      const trades = await settlement.callStatic.computeTradeExecutionsTest(
        encoder.tokens,
        encoder.clearingPrices(prices),
        encoder.trades,
      );
      expect(trades.length).to.equal(tradeCount);
    });

    it("should revert if the order expired", async () => {
      const { timestamp } = await ethers.provider.getBlock("latest");
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        {
          ...partialOrder,
          validTo: timestamp - 1,
          kind: OrderKind.SELL,
          partiallyFillable: false,
        },
        traders[0],
        SigningScheme.EIP712,
      );

      await expect(
        settlement.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.trades,
        ),
      ).to.be.revertedWith("order expired");
    });

    it("should revert if the limit price is not respected", async () => {
      const sellAmount = ethers.utils.parseEther("100.0");
      const sellPrice = 1;
      const buyAmount = ethers.utils.parseEther("1.0");
      const buyPrice = 1000;

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        {
          ...partialOrder,
          sellAmount,
          buyAmount,
          kind: OrderKind.SELL,
          partiallyFillable: false,
        },
        traders[0],
        SigningScheme.EIP712,
      );

      expect(toNumberLossy(sellAmount.mul(sellPrice))).not.to.be.gte(
        toNumberLossy(buyAmount.mul(buyPrice)),
      );
      await expect(
        settlement.callStatic.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices({
            [sellToken]: sellPrice,
            [buyToken]: buyPrice,
          }),
          encoder.trades,
        ),
      ).to.be.revertedWith("limit price not respected");
    });

    it("should not revert if the clearing price is exactly at the limit price", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        {
          ...partialOrder,
          kind: OrderKind.SELL,
          partiallyFillable: false,
        },
        traders[0],
        SigningScheme.EIP712,
      );

      const { sellAmount, buyAmount } = partialOrder;
      const executions = settlement.callStatic.computeTradeExecutionsTest(
        encoder.tokens,
        encoder.clearingPrices({
          [sellToken]: buyAmount,
          [buyToken]: sellAmount,
        }),
        encoder.trades,
      );
      await expect(executions).to.not.be.reverted;

      const [{ buyAmount: executedBuyAmount }] = await executions;
      expect(executedBuyAmount).to.deep.equal(buyAmount);
    });

    describe("Order Executed Amounts", () => {
      const { sellAmount, buyAmount } = partialOrder;
      const executedAmount = ethers.utils.parseEther("10.0");
      const computeSettlementForOrderVariant = async ({
        kind,
        partiallyFillable,
      }: OrderFlags) => {
        const encoder = new SettlementEncoder(testDomain);
        await encoder.signEncodeTrade(
          {
            ...partialOrder,
            kind,
            partiallyFillable,
          },
          traders[0],
          SigningScheme.EIP712,
          { executedAmount },
        );

        const [
          { sellAmount: executedSellAmount, buyAmount: executedBuyAmount },
        ] = await settlement.callStatic.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.trades,
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
        } = await computeSettlementForOrderVariant({
          kind: OrderKind.SELL,
          partiallyFillable: false,
        });

        expect(executedSellAmount).to.deep.equal(sellAmount);
        expect(executedBuyAmount).to.deep.equal(
          sellAmount.mul(sellPrice).div(buyPrice),
        );
      });

      it("should respect the limit price for fill-or-kill sell orders", async () => {
        const { executedBuyAmount } = await computeSettlementForOrderVariant({
          kind: OrderKind.SELL,
          partiallyFillable: false,
        });

        expect(executedBuyAmount.gt(buyAmount)).to.be.true;
      });

      it("should compute amounts for fill-or-kill buy orders", async () => {
        const {
          executedSellAmount,
          sellPrice,
          executedBuyAmount,
          buyPrice,
        } = await computeSettlementForOrderVariant({
          kind: OrderKind.BUY,
          partiallyFillable: false,
        });

        expect(executedSellAmount).to.deep.equal(
          buyAmount.mul(buyPrice).div(sellPrice),
        );
        expect(executedBuyAmount).to.deep.equal(buyAmount);
      });

      it("should respect the limit price for fill-or-kill buy orders", async () => {
        const { executedSellAmount } = await computeSettlementForOrderVariant({
          kind: OrderKind.BUY,
          partiallyFillable: false,
        });

        expect(executedSellAmount.lt(sellAmount)).to.be.true;
      });

      it("should compute amounts for partially fillable sell orders", async () => {
        const {
          executedSellAmount,
          sellPrice,
          executedBuyAmount,
          buyPrice,
        } = await computeSettlementForOrderVariant({
          kind: OrderKind.SELL,
          partiallyFillable: true,
        });

        expect(executedSellAmount).to.deep.equal(executedAmount);
        expect(executedBuyAmount).to.deep.equal(
          executedAmount.mul(sellPrice).div(buyPrice),
        );
      });

      it("should respect the limit price for partially fillable sell orders", async () => {
        const {
          executedSellAmount,
          executedBuyAmount,
        } = await computeSettlementForOrderVariant({
          kind: OrderKind.SELL,
          partiallyFillable: true,
        });

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
        } = await computeSettlementForOrderVariant({
          kind: OrderKind.BUY,
          partiallyFillable: true,
        });

        expect(executedSellAmount).to.deep.equal(
          executedAmount.mul(buyPrice).div(sellPrice),
        );
        expect(executedBuyAmount).to.deep.equal(executedAmount);
      });

      it("should respect the limit price for partially fillable buy orders", async () => {
        const {
          executedSellAmount,
          executedBuyAmount,
        } = await computeSettlementForOrderVariant({
          kind: OrderKind.BUY,
          partiallyFillable: true,
        });

        expect(
          executedBuyAmount
            .mul(sellAmount)
            .gt(executedSellAmount.mul(buyAmount)),
        ).to.be.true;
      });

      describe("should revert if order is executed for a too large amount", () => {
        it("sell order", async () => {
          const encoder = new SettlementEncoder(testDomain);
          const executedAmount = partialOrder.sellAmount.add(1);
          await encoder.signEncodeTrade(
            {
              ...partialOrder,
              kind: OrderKind.SELL,
              partiallyFillable: true,
            },
            traders[0],
            SigningScheme.EIP712,
            { executedAmount },
          );

          await expect(
            settlement.computeTradeExecutionsTest(
              encoder.tokens,
              encoder.clearingPrices(prices),
              encoder.trades,
            ),
          ).to.be.revertedWith("GPv2: order filled");
        });

        it("already partially filled sell order", async () => {
          let encoder = new SettlementEncoder(testDomain);
          const initialExecutedAmount = partialOrder.sellAmount.div(2);
          expect(initialExecutedAmount).not.to.deep.equal(
            ethers.constants.Zero,
          );
          await encoder.signEncodeTrade(
            {
              ...partialOrder,
              kind: OrderKind.SELL,
              partiallyFillable: true,
            },
            traders[0],
            SigningScheme.EIP712,
            { executedAmount: initialExecutedAmount },
          );
          await settlement.computeTradeExecutionsTest(
            encoder.tokens,
            encoder.clearingPrices(prices),
            encoder.trades,
          );

          encoder = new SettlementEncoder(testDomain);
          const unfilledAmount = partialOrder.sellAmount.sub(
            initialExecutedAmount,
          );
          expect(initialExecutedAmount).not.to.deep.equal(
            ethers.constants.Zero,
          );
          await encoder.signEncodeTrade(
            {
              ...partialOrder,
              kind: OrderKind.SELL,
              partiallyFillable: true,
            },
            traders[0],
            SigningScheme.EIP712,
            { executedAmount: unfilledAmount.add(1) },
          );
          await expect(
            settlement.computeTradeExecutionsTest(
              encoder.tokens,
              encoder.clearingPrices(prices),
              encoder.trades,
            ),
          ).to.be.revertedWith("GPv2: order filled");
        });

        it("buy order", async () => {
          const encoder = new SettlementEncoder(testDomain);
          const executedAmount = partialOrder.buyAmount.add(1);
          await encoder.signEncodeTrade(
            {
              ...partialOrder,
              kind: OrderKind.BUY,
              partiallyFillable: true,
            },
            traders[0],
            SigningScheme.EIP712,
            { executedAmount },
          );

          await expect(
            settlement.computeTradeExecutionsTest(
              encoder.tokens,
              encoder.clearingPrices(prices),
              encoder.trades,
            ),
          ).to.be.revertedWith("GPv2: order filled");
        });
      });
    });

    describe("Order Executed Fees", () => {
      const { sellAmount, buyAmount } = partialOrder;
      const feeAmount = ethers.utils.parseEther("10");
      const { [sellToken]: sellPrice, [buyToken]: buyPrice } = prices;
      const computeExecutedTradeForOrderVariant = async (
        { kind, partiallyFillable }: OrderFlags,
        tradeExecution?: Partial<TradeExecution>,
      ) => {
        const encoder = new SettlementEncoder(testDomain);
        await encoder.signEncodeTrade(
          {
            ...partialOrder,
            feeAmount,
            kind,
            partiallyFillable,
          },
          traders[0],
          SigningScheme.EIP712,
          tradeExecution,
        );

        const [trade] = await settlement.callStatic.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.trades,
        );

        return trade;
      };

      it("should add the full fee for fill-or-kill sell orders", async () => {
        const trade = await computeExecutedTradeForOrderVariant({
          kind: OrderKind.SELL,
          partiallyFillable: false,
        });

        expect(trade.sellAmount).to.deep.equal(sellAmount.add(feeAmount));
      });

      it("should add the full fee for fill-or-kill buy orders", async () => {
        const trade = await computeExecutedTradeForOrderVariant({
          kind: OrderKind.BUY,
          partiallyFillable: false,
        });

        const executedSellAmount = buyAmount.mul(buyPrice).div(sellPrice);
        expect(trade.sellAmount).to.deep.equal(
          executedSellAmount.add(feeAmount),
        );
      });

      it("should add portion of fees for partially filled sell orders", async () => {
        const executedSellAmount = sellAmount.div(3);
        const executedFee = feeAmount.div(3);

        const trade = await computeExecutedTradeForOrderVariant(
          { kind: OrderKind.SELL, partiallyFillable: true },
          { executedAmount: executedSellAmount },
        );

        expect(trade.sellAmount).to.deep.equal(
          executedSellAmount.add(executedFee),
        );
      });

      it("should add portion of fees for partially filled buy orders", async () => {
        const executedBuyAmount = buyAmount.div(4);
        const executedFee = feeAmount.div(4);

        const trade = await computeExecutedTradeForOrderVariant(
          { kind: OrderKind.BUY, partiallyFillable: true },
          { executedAmount: executedBuyAmount },
        );

        const executedSellAmount = executedBuyAmount
          .mul(buyPrice)
          .div(sellPrice);
        expect(trade.sellAmount).to.deep.equal(
          executedSellAmount.add(executedFee),
        );
      });

      it("should apply the fee discount to the executed fees", async () => {
        const feeDiscount = feeAmount.div(100); // 1% discount.
        const trade = await computeExecutedTradeForOrderVariant(
          {
            kind: OrderKind.SELL,
            partiallyFillable: false,
          },
          { feeDiscount },
        );

        expect(trade.sellAmount).to.deep.equal(
          sellAmount.add(feeAmount.sub(feeDiscount)),
        );
      });
    });

    describe("Order Filled Amounts", () => {
      const { sellAmount, buyAmount } = partialOrder;
      const readOrderFilledAmountAfterProcessing = async (
        { kind, partiallyFillable }: OrderFlags,
        tradeExecution?: Partial<TradeExecution>,
      ) => {
        const order = {
          ...partialOrder,
          kind,
          partiallyFillable,
        };
        const encoder = new SettlementEncoder(testDomain);
        await encoder.signEncodeTrade(
          order,
          traders[0],
          SigningScheme.EIP712,
          tradeExecution,
        );

        await settlement.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.trades,
        );

        const orderUid = computeOrderUid(testDomain, order, traders[0].address);
        const filledAmount = await settlement.filledAmount(orderUid);

        return filledAmount;
      };

      it("should fill the full sell amount for fill-or-kill sell orders", async () => {
        const filledAmount = await readOrderFilledAmountAfterProcessing({
          kind: OrderKind.SELL,
          partiallyFillable: false,
        });

        expect(filledAmount).to.deep.equal(sellAmount);
      });

      it("should fill the full buy amount for fill-or-kill buy orders", async () => {
        const filledAmount = await readOrderFilledAmountAfterProcessing({
          kind: OrderKind.BUY,
          partiallyFillable: false,
        });

        expect(filledAmount).to.deep.equal(buyAmount);
      });

      it("should fill the executed amount for partially filled sell orders", async () => {
        const executedSellAmount = sellAmount.div(3);
        const filledAmount = await readOrderFilledAmountAfterProcessing(
          { kind: OrderKind.SELL, partiallyFillable: true },
          { executedAmount: executedSellAmount },
        );

        expect(filledAmount).to.deep.equal(executedSellAmount);
      });

      it("should fill the executed amount for partially filled buy orders", async () => {
        const executedBuyAmount = buyAmount.div(4);
        const filledAmount = await readOrderFilledAmountAfterProcessing(
          { kind: OrderKind.BUY, partiallyFillable: true },
          { executedAmount: executedBuyAmount },
        );

        expect(filledAmount).to.deep.equal(executedBuyAmount);
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
        { ...order, appData: 0 },
        traders[0],
        SigningScheme.EIP712,
      );
      await encoder.signEncodeTrade(
        { ...order, appData: 1 },
        traders[0],
        SigningScheme.EIP712,
        { executedAmount: ethers.utils.parseEther("1.0") },
      );

      const trades = await settlement.callStatic.computeTradeExecutionsTest(
        encoder.tokens,
        encoder.clearingPrices(prices),
        encoder.trades,
      );

      expect(trades[0]).to.deep.equal(trades[1]);
    });

    it("should revert on invalid fee discount values", async () => {
      const feeAmount = ethers.utils.parseEther("1.0");

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        {
          ...partialOrder,
          kind: OrderKind.BUY,
          partiallyFillable: false,
          feeAmount,
        },
        traders[0],
        SigningScheme.EIP712,
        { feeDiscount: feeAmount.add(1) },
      );

      await expect(
        settlement.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.trades,
        ),
      ).to.be.revertedWith("fee discount too large");
    });

    it("should emit a trade event", async () => {
      const order = {
        ...partialOrder,
        kind: OrderKind.SELL,
        partiallyFillable: false,
      };

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(order, traders[0], SigningScheme.EIP712);

      const executedSellAmount = order.sellAmount.add(order.feeAmount);
      const executedBuyAmount = order.sellAmount
        .mul(prices[sellToken])
        .div(prices[buyToken]);

      const tx = settlement.computeTradeExecutionsTest(
        encoder.tokens,
        encoder.clearingPrices(prices),
        encoder.trades,
      );
      await expect(tx)
        .to.emit(settlement, "Trade")
        .withArgs(
          traders[0].address,
          order.sellToken,
          order.buyToken,
          executedSellAmount,
          executedBuyAmount,
          order.feeAmount,
          computeOrderUid(testDomain, order, traders[0].address),
        );

      const { events } = await (await tx).wait();
      const tradeEvents = events.filter(
        ({ event }: Event) => event === "Trade",
      );
      expect(tradeEvents.length).to.equal(1);
    });
  });

  describe("computeTradeExecution", () => {
    it("should not allocate additional memory", async () => {
      expect(
        await settlement.callStatic.computeTradeExecutionMemoryTest(),
      ).to.deep.equal(ethers.constants.Zero);
    });
  });

  describe("executeSingleTrade", () => {
    const [trader, transferTarget, receiver] = traders;

    let sellToken: MockContract;
    let buyToken: Contract;

    beforeEach(async () => {
      sellToken = await waffle.deployMockContract(deployer, IERC20.abi);

      const BalanceOf = await ethers.getContractFactory("BalanceOf");
      buyToken = await BalanceOf.deploy();
    });

    const prepareOrder = (
      orderOverrides: OrderFlags & Partial<Order>,
    ): Order => {
      return {
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: ethers.utils.parseEther("42"),
        buyAmount: ethers.utils.parseEther("13.37"),
        validTo: 0xffffffff,
        appData: 0,
        feeAmount: ethers.constants.Zero,
        ...orderOverrides,
      };
    };

    interface SingleTradeExecution {
      transferOutAmount: BigNumberish;
      receiverBalanceIncreaseAmount: BigNumberish;
      feeDiscount: BigNumberish;
    }

    const prepareTrade = async (
      order: Order,
      execution?: Partial<SingleTradeExecution>,
    ): Promise<[string[], Trade, Transfer[], Interaction[]]> => {
      const receiver = order.receiver ?? trader.address;

      const {
        transferOutAmount,
        receiverBalanceIncreaseAmount,
        feeDiscount,
      } = {
        transferOutAmount: order.sellAmount,
        receiverBalanceIncreaseAmount: order.buyAmount,
        feeDiscount: 0,
        ...(execution || {}),
      };

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(order, trader, SigningScheme.EIP712, {
        feeDiscount,
        executedAmount: ethers.constants.Zero,
      });

      await sellToken.mock.transferFrom
        .withArgs(trader.address, transferTarget.address, transferOutAmount)
        .returns(true);

      const initialBalance = ethers.utils.parseEther("42.0");
      await buyToken.setBalanceOf(receiver, initialBalance);

      const transfer = {
        target: transferTarget.address,
        amount: transferOutAmount,
      };

      // NOTE: Use an interaction to update the mock balance contract.
      encoder.encodeInteraction({
        target: buyToken.address,
        value: 0,
        callData: buyToken.interface.encodeFunctionData("setBalanceOf", [
          receiver,
          initialBalance.add(receiverBalanceIncreaseAmount),
        ]),
      });

      return encoder.encodeSingleTradeSettlement([transfer]);
    };

    describe("Trade event", () => {
      it("has correct executed amounts for a sell order", async () => {
        await authenticator.connect(owner).addSolver(solver.address);

        const feeAmount = ethers.utils.parseEther("0.01");
        const executedFeeAmount = ethers.utils.parseEther("0.0042");

        const order = prepareOrder({
          kind: OrderKind.SELL,
          partiallyFillable: true,
          feeAmount,
        });
        const executedSellAmount = executedFeeAmount.add(order.sellAmount);
        const executedBuyAmount = ethers.utils
          .parseEther("0.1134")
          .add(order.buyAmount);

        await expect(
          settlement.connect(solver).executeSingleTradeTest(
            ...(await prepareTrade(order, {
              transferOutAmount: executedSellAmount,
              receiverBalanceIncreaseAmount: executedBuyAmount,
              feeDiscount: feeAmount.sub(executedFeeAmount),
            })),
          ),
        )
          .to.emit(settlement, "Trade")
          .withArgs(
            trader.address,
            sellToken.address,
            buyToken.address,
            executedSellAmount,
            executedBuyAmount,
            executedFeeAmount,
            computeOrderUid(testDomain, order, trader.address),
          );
      });

      it("has correct executed amounts for a buy order", async () => {
        await authenticator.connect(owner).addSolver(solver.address);

        const feeAmount = ethers.utils.parseEther("0.01");
        const executedFeeAmount = ethers.utils.parseEther("0.0042");

        const order = prepareOrder({
          kind: OrderKind.BUY,
          partiallyFillable: true,
          feeAmount,
        });
        const executedSellAmount = executedFeeAmount
          .add(order.sellAmount)
          .sub(ethers.utils.parseEther("0.1134"));
        const executedBuyAmount = order.buyAmount;

        await expect(
          settlement.connect(solver).executeSingleTradeTest(
            ...(await prepareTrade(order, {
              transferOutAmount: executedSellAmount,
              receiverBalanceIncreaseAmount: executedBuyAmount,
              feeDiscount: feeAmount.sub(executedFeeAmount),
            })),
          ),
        )
          .to.emit(settlement, "Trade")
          .withArgs(
            trader.address,
            sellToken.address,
            buyToken.address,
            executedSellAmount,
            executedBuyAmount,
            executedFeeAmount,
            computeOrderUid(testDomain, order, trader.address),
          );
      });
    });

    describe("Order Variants", () => {
      it("sets filled amount for sell orders", async () => {
        const order = prepareOrder({
          kind: OrderKind.SELL,
          partiallyFillable: false,
        });

        await authenticator.connect(owner).addSolver(solver.address);
        await settlement
          .connect(solver)
          .executeSingleTradeTest(...(await prepareTrade(order)));

        expect(
          await settlement.filledAmount(
            computeOrderUid(testDomain, order, trader.address),
          ),
        ).to.equal(order.sellAmount);
      });

      it("sets filled amount for buy orders", async () => {
        const order = prepareOrder({
          kind: OrderKind.BUY,
          partiallyFillable: false,
        });

        await authenticator.connect(owner).addSolver(solver.address);
        await settlement
          .connect(solver)
          .executeSingleTradeTest(...(await prepareTrade(order)));

        expect(
          await settlement.filledAmount(
            computeOrderUid(testDomain, order, trader.address),
          ),
        ).to.equal(order.buyAmount);
      });

      it("reverts on invalid executed sell amount for sell orders", async () => {
        const order = prepareOrder({
          kind: OrderKind.SELL,
          partiallyFillable: true,
        });

        await authenticator.connect(owner).addSolver(solver.address);
        await expect(
          settlement.connect(solver).executeSingleTradeTest(
            ...(await prepareTrade(
              order,
              // NOTE: Order is treated as fill or kill, and even if the
              // executed amount is favourable for the user, the settlement
              // reverts.
              { transferOutAmount: BigNumber.from(order.sellAmount).sub(1) },
            )),
          ),
        ).to.be.revertedWith("invalid sell amount");
      });

      it("reverts on invalid executed buy amount for buy orders", async () => {
        const order = prepareOrder({
          kind: OrderKind.BUY,
          partiallyFillable: true,
        });

        await authenticator.connect(owner).addSolver(solver.address);
        await expect(
          settlement.connect(solver).executeSingleTradeTest(
            ...(await prepareTrade(
              order,
              // NOTE: Order is treated as fill or kill, and even if the
              // executed amount is favourable for the user, the settlement
              // reverts.
              {
                receiverBalanceIncreaseAmount: BigNumber.from(
                  order.buyAmount,
                ).add(1),
              },
            )),
          ),
        ).to.be.revertedWith("invalid buy amount");
      });

      it("reverts when executed buy amount is too low for sell orders", async () => {
        const order = prepareOrder({
          kind: OrderKind.SELL,
          partiallyFillable: true,
          receiver: receiver.address,
        });

        await authenticator.connect(owner).addSolver(solver.address);
        await expect(
          settlement.connect(solver).executeSingleTradeTest(
            ...(await prepareTrade(order, {
              receiverBalanceIncreaseAmount: BigNumber.from(
                order.buyAmount,
              ).sub(1),
            })),
          ),
        ).to.be.revertedWith("buy amount too low");
      });

      it("reverts when executed sell amount is too high for buy orders", async () => {
        const order = prepareOrder({
          kind: OrderKind.BUY,
          partiallyFillable: false,
          receiver: receiver.address,
        });

        await authenticator.connect(owner).addSolver(solver.address);
        await expect(
          settlement.connect(solver).executeSingleTradeTest(
            ...(await prepareTrade(order, {
              transferOutAmount: BigNumber.from(order.sellAmount).add(1),
            })),
          ),
        ).to.be.revertedWith("sell amount too high");
      });
    });

    it("rejects expired order", async () => {
      const order = prepareOrder({
        kind: OrderKind.SELL,
        partiallyFillable: false,
        validTo: 0,
      });

      await authenticator.connect(owner).addSolver(solver.address);
      await expect(
        settlement
          .connect(solver)
          .executeSingleTradeTest(...(await prepareTrade(order))),
      ).to.be.revertedWith("order expired");
    });

    it("ignores trade executed amount field", async () => {
      const order = prepareOrder({
        kind: OrderKind.SELL,
        partiallyFillable: true,
      });

      const [tokens, trade, transfers, interactions] = await prepareTrade(
        order,
      );
      trade.executedAmount = ethers.utils.parseEther("1447.42");
      expect(trade.executedAmount).not.to.equal(order.sellAmount);

      await authenticator.connect(owner).addSolver(solver.address);
      await settlement
        .connect(solver)
        .executeSingleTradeTest(tokens, trade, transfers, interactions);

      expect(
        await settlement.filledAmount(
          computeOrderUid(testDomain, order, trader.address),
        ),
      ).to.equal(order.sellAmount);
    });

    it("reverts when fee discount is too high", async () => {
      const feeAmount = ethers.utils.parseEther("0.01");
      const order = prepareOrder({
        kind: OrderKind.BUY,
        partiallyFillable: true,
        feeAmount,
      });

      await authenticator.connect(owner).addSolver(solver.address);
      await expect(
        settlement.connect(solver).executeSingleTradeTest(
          ...(await prepareTrade(order, {
            feeDiscount: feeAmount.add(1),
          })),
        ),
      ).to.be.revertedWith("fee discount too high");
    });
  });

  describe("executeInteractions", () => {
    it("executes valid interactions", async () => {
      const EventEmitter = await ethers.getContractFactory("EventEmitter");
      const interactionParameters = [
        {
          target: await EventEmitter.deploy(),
          value: ethers.utils.parseEther("0.42"),
          number: 1,
        },
        {
          target: await EventEmitter.deploy(),
          value: ethers.utils.parseEther("0.1337"),
          number: 2,
        },
        {
          target: await EventEmitter.deploy(),
          value: ethers.constants.Zero,
          number: 3,
        },
      ];

      const uniqueContractAddresses = new Set(
        interactionParameters.map((params) => params.target.address),
      );
      expect(uniqueContractAddresses.size).to.equal(
        interactionParameters.length,
      );

      const interactions = interactionParameters.map(
        ({ target, value, number }) => ({
          target: target.address,
          value,
          callData: target.interface.encodeFunctionData("emitEvent", [number]),
        }),
      );

      // Note: make sure to send some Ether to the settlement contract so that
      // it can execute the interactions with values.
      await deployer.sendTransaction({
        to: settlement.address,
        value: ethers.utils.parseEther("1.0"),
      });

      const settled = settlement.executeInteractionsTest(interactions);
      const { events }: ContractReceipt = await (await settled).wait();

      // Note: all contracts were touched.
      for (const { target } of interactionParameters) {
        await expect(settled).to.emit(target, "Event");
      }
      await expect(settled).to.emit(settlement, "Interaction");

      const emitterEvents = (events || []).filter(
        ({ address }) => address !== settlement.address,
      );
      expect(emitterEvents.length).to.equal(interactionParameters.length);

      // Note: the execution order was respected.
      for (let i = 0; i < interactionParameters.length; i++) {
        const params = interactionParameters[i];
        const args = params.target.interface.decodeEventLog(
          "Event",
          emitterEvents[i].data,
        );

        expect(args.value).to.equal(params.value);
        expect(args.number).to.equal(params.number);
      }
    });

    it("reverts if any of the interactions reverts", async () => {
      const mockPass = await waffle.deployMockContract(deployer, [
        "function alwaysPasses()",
      ]);
      await mockPass.mock.alwaysPasses.returns();
      const mockRevert = await waffle.deployMockContract(deployer, [
        "function alwaysReverts()",
      ]);
      await mockRevert.mock.alwaysReverts.revertsWithReason("test error");

      await expect(
        settlement.executeInteractionsTest(
          normalizeInteractions([
            {
              target: mockPass.address,
              callData: mockPass.interface.encodeFunctionData("alwaysPasses"),
            },
            {
              target: mockRevert.address,
              callData: mockRevert.interface.encodeFunctionData(
                "alwaysReverts",
              ),
            },
          ]),
        ),
      ).to.be.revertedWith("test error");
    });

    it("should revert when target is allowanceManager", async () => {
      const invalidInteraction: Interaction = {
        target: await settlement.allowanceManager(),
        callData: [],
        value: 0,
      };

      await expect(
        settlement.executeInteractionsTest([invalidInteraction]),
      ).to.be.revertedWith("GPv2: forbidden interaction");
    });

    it("reverts if the settlement contract does not have sufficient Ether balance", async () => {
      const value = ethers.utils.parseEther("1000000.0");
      expect(value.gt(await ethers.provider.getBalance(settlement.address))).to
        .be.true;

      await expect(
        settlement.executeInteractionsTest(
          normalizeInteractions([
            {
              target: ethers.constants.AddressZero,
              value,
            },
          ]),
        ),
      ).to.be.reverted;
    });

    it("emits an Interaction event", async () => {
      const contract = await waffle.deployMockContract(deployer, [
        "function someFunction(bytes32 parameter)",
      ]);

      const value = ethers.utils.parseEther("1.0");
      const parameter = `0x${"ff".repeat(32)}`;

      await deployer.sendTransaction({ to: settlement.address, value });
      await contract.mock.someFunction.withArgs(parameter).returns();

      const tx = settlement.executeInteractionsTest([
        {
          target: contract.address,
          value,
          callData: contract.interface.encodeFunctionData("someFunction", [
            parameter,
          ]),
        },
      ]);
      await expect(tx)
        .to.emit(settlement, "Interaction")
        .withArgs(
          contract.address,
          value,
          contract.interface.getSighash("someFunction"),
        );
    });
  });

  describe("transferOut", () => {
    it("should execute ERC20 transfers", async () => {
      const tokens = [
        await waffle.deployMockContract(deployer, IERC20.abi),
        await waffle.deployMockContract(deployer, IERC20.abi),
      ];

      const amount = ethers.utils.parseEther("13.37");
      await tokens[0].mock.transfer
        .withArgs(traders[0].address, amount)
        .returns(true);
      await tokens[1].mock.transfer
        .withArgs(traders[2].address, amount)
        .returns(true);

      await expect(
        settlement.transferOutTest(
          encodeOutTransfers([
            {
              owner: traders[0].address,
              receiver: traders[0].address,
              buyToken: tokens[0].address,
              buyAmount: amount,
            },
            {
              owner: traders[1].address,
              receiver: traders[2].address,
              buyToken: tokens[1].address,
              buyAmount: amount,
            },
          ]),
        ),
      ).to.not.be.reverted;
    });
  });

  describe("claimOrderRefunds", () => {
    it("should set filled amount to 0 for all orders", async () => {
      const orderUids = [
        packOrderUidParams({
          orderDigest: `0x${"11".repeat(32)}`,
          owner: traders[0].address,
          validTo: 0,
        }),
        packOrderUidParams({
          orderDigest: `0x${"22".repeat(32)}`,
          owner: traders[0].address,
          validTo: 0,
        }),
        packOrderUidParams({
          orderDigest: `0x${"33".repeat(32)}`,
          owner: traders[0].address,
          validTo: 0,
        }),
      ];

      for (const orderUid of orderUids) {
        await settlement.connect(traders[0]).invalidateOrder(orderUid);
        expect(await settlement.filledAmount(orderUid)).to.not.deep.equal(
          ethers.constants.Zero,
        );
      }

      await settlement.claimOrderRefundsTest(
        encodeFilledAmountRefunds(...orderUids),
      );
      for (const orderUid of orderUids) {
        expect(await settlement.filledAmount(orderUid)).to.deep.equal(
          ethers.constants.Zero,
        );
      }
    });

    it("should clear pre-signatures", async () => {
      const orderUid = packOrderUidParams({
        orderDigest: `0x${"11".repeat(32)}`,
        owner: traders[0].address,
        validTo: 0,
      });

      await settlement.connect(traders[0]).setPreSignature(orderUid, true);
      await settlement.claimOrderRefundsTest(
        encodePreSignatureRefunds(orderUid),
      );

      expect(await settlement.preSignature(orderUid)).to.equal(
        ethers.constants.Zero,
      );
    });

    it("should revert if the encoded order UIDs are malformed", async () => {
      const orderUid = packOrderUidParams({
        orderDigest: ethers.constants.HashZero,
        owner: ethers.constants.AddressZero,
        validTo: 0,
      });

      for (const malformedOrderUid of [
        ethers.utils.hexDataSlice(orderUid, 0, 55),
        ethers.utils.hexZeroPad(orderUid, 57),
      ]) {
        await expect(
          settlement.claimOrderRefundsTest(
            encodeFilledAmountRefunds(malformedOrderUid),
          ),
        ).to.be.reverted;
        await expect(
          settlement.claimOrderRefundsTest(
            encodePreSignatureRefunds(malformedOrderUid),
          ),
        ).to.be.reverted;
      }
    });

    it("should revert if the order is still valid", async () => {
      const orderDigest = "0x" + "11".repeat(32);
      const orderUid = packOrderUidParams({
        orderDigest,
        owner: traders[0].address,
        validTo: 0xffffffff,
      });

      await expect(
        settlement.claimOrderRefundsTest(encodeFilledAmountRefunds(orderUid)),
      ).to.be.revertedWith("order still valid");
      await expect(
        settlement.claimOrderRefundsTest(encodePreSignatureRefunds(orderUid)),
      ).to.be.revertedWith("order still valid");
    });
  });
});
