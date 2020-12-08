import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { BigNumber, Contract, TypedDataDomain } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import {
  OrderFlags,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  allowanceManagerAddress,
  domain,
  computeOrderUid,
  hashOrder,
} from "../src/ts";

import { builtAndDeployedMetadataCoincide } from "./bytecode";
import {
  decodeExecutedTrades,
  encodeOutTransfers,
  Interaction,
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

  describe("filledAmount", () => {
    it("is zero for an uninitialized order", async () => {
      const zeroBytes = ethers.constants.HashZero;
      expect(await settlement.filledAmount(zeroBytes)).to.equal(
        ethers.constants.Zero,
      );
    });
  });

  describe("getFilledAmount", () => {
    it("is zero for an untouched order", async () => {
      const orderUid = ethers.constants.HashZero;
      const owner = ethers.constants.AddressZero;
      const validTo = 2 ** 32 - 1;

      expect(
        await settlement.getFilledAmount(
          computeOrderUid(orderUid, owner, validTo),
        ),
      ).to.equal(ethers.constants.Zero);
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

  describe("invalidateOrder", () => {
    it("sets filled amount of the caller's order to max uint256", async () => {
      const orderDigest = "0x" + "11".repeat(32);
      const validTo = 2 ** 32 - 1;
      const orderUid = computeOrderUid(
        orderDigest,
        traders[0].address,
        validTo,
      );

      await settlement.connect(traders[0]).invalidateOrder(orderUid);
      expect(await settlement.getFilledAmount(orderUid)).to.equal(
        ethers.constants.MaxUint256,
      );
    });
    it("fails to invalidate order that is not owned by the caller", async () => {
      const orderDigest = "0x".padEnd(66, "1");
      const validTo = 2 ** 32 - 1;
      const orderUid = computeOrderUid(
        orderDigest,
        traders[0].address,
        validTo,
      );

      await expect(settlement.invalidateOrder(orderUid)).to.be.revertedWith(
        "GPv2: caller does not own order",
      );
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
          ethers.utils.parseEther("0.7734"),
          traders[0],
          SigningScheme.TYPED_DATA,
        );
      }

      const trades = decodeExecutedTrades(
        await settlement.callStatic.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.encodedTrades,
        ),
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
        0,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      await expect(
        settlement.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.encodedTrades,
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
        0,
        traders[0],
        SigningScheme.TYPED_DATA,
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
          encoder.encodedTrades,
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
        0,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const { sellAmount, buyAmount } = partialOrder;
      const executions = settlement.callStatic.computeTradeExecutionsTest(
        encoder.tokens,
        encoder.clearingPrices({
          [sellToken]: buyAmount,
          [buyToken]: sellAmount,
        }),
        encoder.encodedTrades,
      );
      await expect(executions).to.not.be.reverted;

      const [{ buyAmount: executedBuyAmount }] = decodeExecutedTrades(
        await executions,
      );
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
          executedAmount,
          traders[0],
          SigningScheme.TYPED_DATA,
        );

        const [
          { sellAmount: executedSellAmount, buyAmount: executedBuyAmount },
        ] = decodeExecutedTrades(
          await settlement.callStatic.computeTradeExecutionsTest(
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
    });

    describe("Order Executed Fees", () => {
      const { sellAmount, buyAmount } = partialOrder;
      const feeAmount = ethers.utils.parseEther("10");
      const { [sellToken]: sellPrice, [buyToken]: buyPrice } = prices;
      const computeExecutedTradeForOrderVariant = async (
        { kind, partiallyFillable }: OrderFlags,
        executedAmount?: BigNumber,
      ) => {
        const encoder = new SettlementEncoder(testDomain);
        await encoder.signEncodeTrade(
          {
            ...partialOrder,
            feeAmount,
            kind,
            partiallyFillable,
          },
          executedAmount || 0,
          traders[0],
          SigningScheme.TYPED_DATA,
        );

        const [trade] = decodeExecutedTrades(
          await settlement.callStatic.computeTradeExecutionsTest(
            encoder.tokens,
            encoder.clearingPrices(prices),
            encoder.encodedTrades,
          ),
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
          executedSellAmount,
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
          executedBuyAmount,
        );

        const executedSellAmount = executedBuyAmount
          .mul(buyPrice)
          .div(sellPrice);
        expect(trade.sellAmount).to.deep.equal(
          executedSellAmount.add(executedFee),
        );
      });
    });

    describe("Order Filled Amounts", () => {
      const { sellAmount, buyAmount } = partialOrder;
      const readOrderFilledAmountAfterProcessing = async (
        { kind, partiallyFillable }: OrderFlags,
        executedAmount?: BigNumber,
      ) => {
        const order = {
          ...partialOrder,
          kind,
          partiallyFillable,
        };
        const encoder = new SettlementEncoder(testDomain);
        await encoder.signEncodeTrade(
          order,
          executedAmount || 0,
          traders[0],
          SigningScheme.TYPED_DATA,
        );

        await settlement.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.encodedTrades,
        );

        const orderUid = computeOrderUid(
          hashOrder(order),
          traders[0].address,
          order.validTo,
        );
        const filledAmount = await settlement.getFilledAmount(orderUid);

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
          executedSellAmount,
        );

        expect(filledAmount).to.deep.equal(executedSellAmount);
      });

      it("should fill the executed amount for partially filled buy orders", async () => {
        const executedBuyAmount = buyAmount.div(4);
        const filledAmount = await readOrderFilledAmountAfterProcessing(
          { kind: OrderKind.BUY, partiallyFillable: true },
          executedBuyAmount,
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
        0,
        traders[0],
        SigningScheme.TYPED_DATA,
      );
      await encoder.signEncodeTrade(
        { ...order, appData: 1 },
        ethers.utils.parseEther("1.0"),
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const trades = decodeExecutedTrades(
        await settlement.callStatic.computeTradeExecutionsTest(
          encoder.tokens,
          encoder.clearingPrices(prices),
          encoder.encodedTrades,
        ),
      );

      expect(trades[0]).to.deep.equal(trades[1]);
    });
  });

  describe("computeTradeExecution", () => {
    it("should not allocate additional memory", async () => {
      expect(
        await settlement.callStatic.computeTradeExecutionMemoryTest(),
      ).to.deep.equal(ethers.constants.Zero);
    });
  });

  describe("executeInteraction", () => {
    it("should fail when target is allowanceManager", async () => {
      const invalidInteraction: Interaction = {
        target: allowanceManagerAddress(settlement.address),
        callData: [],
      };

      await expect(
        settlement.callStatic.executeInteractionTest(invalidInteraction),
      ).to.be.revertedWith("GPv2: forbidden interaction");
    });

    it("should fail when interaction reverts", async () => {
      const addSolverCallData = authenticator.interface.encodeFunctionData(
        "addSolver",
        [solver.address],
      );
      const invalidInteraction: Interaction = {
        target: authenticator.address,
        callData: addSolverCallData,
      };
      // settlment contract can't add solvers.
      await expect(
        settlement.callStatic.executeInteractionTest(invalidInteraction),
      ).to.be.revertedWith("GPv2: failed interaction");
    });

    it.only("should pass on successfull execution", async () => {
      const isSolverCallData = authenticator.interface.encodeFunctionData(
        "isSolver",
        [solver.address],
      );
      // Note that calling a view method is a valid transaction.
      const validInteraction: Interaction = {
        target: authenticator.address,
        callData: isSolverCallData,
      };
      await expect(
        settlement.callStatic.executeInteractionTest(validInteraction),
      ).to.not.be.reverted;
    });
  });

  describe("extractOrderUidParams", () => {
    function fillDistinctBytes(count: number, start: number): string {
      return [...Array(count)]
        .map((_, i) => ((start + i) % 256).toString(16).padStart(2, "0"))
        .join("");
    }

    it("round trip encode/decode", async () => {
      // Start from 17 (0x11) so that the first byte has no zeroes.
      const orderDigest = "0x" + fillDistinctBytes(32, 17);
      const address = ethers.utils.getAddress(
        "0x" + fillDistinctBytes(20, 17 + 32),
      );
      const validTo = parseInt(fillDistinctBytes(4, 17 + 32 + 20), 16);
      const orderUid = computeOrderUid(orderDigest, address, validTo);
      expect(orderUid).to.equal("0x" + fillDistinctBytes(32 + 20 + 4, 17));

      const {
        orderDigest: extractedOrderDigest,
        owner: extractedAddress,
        validTo: extractedValidTo,
      } = await settlement.extractOrderUidParamsTest(orderUid);
      expect(extractedOrderDigest).to.equal(orderDigest);
      expect(extractedValidTo).to.equal(validTo);
      expect(extractedAddress).to.equal(address);
    });

    describe("fails on uid", () => {
      const uidStride = 32 + 20 + 4;

      it("longer than expected", async () => {
        const invalidUid = "0x" + "00".repeat(uidStride + 1);

        await expect(settlement.getFilledAmount(invalidUid)).to.be.revertedWith(
          "GPv2: invalid uid",
        );
      });

      it("shorter than expected", async () => {
        const invalidUid = "0x" + "00".repeat(uidStride - 1);

        await expect(settlement.getFilledAmount(invalidUid)).to.be.revertedWith(
          "GPv2: invalid uid",
        );
      });
    });
  });

  describe("transferOut", () => {
    it("should execute ERC20 transfers", async () => {
      const NonStandardERC20 = await artifacts.readArtifact("NonStandardERC20");
      const tokens = [
        await waffle.deployMockContract(deployer, IERC20.abi),
        await waffle.deployMockContract(deployer, NonStandardERC20.abi),
      ];

      const amount = ethers.utils.parseEther("13.37");
      await tokens[0].mock.transfer
        .withArgs(traders[0].address, amount)
        .returns(true);
      await tokens[1].mock.transfer
        .withArgs(traders[1].address, amount)
        .returns();

      await expect(
        settlement.transferOutTest(
          encodeOutTransfers([
            {
              owner: traders[0].address,
              buyToken: tokens[0].address,
              buyAmount: amount,
            },
            {
              owner: traders[1].address,
              buyToken: tokens[1].address,
              buyAmount: amount,
            },
          ]),
        ),
      ).to.not.be.reverted;
    });
  });
});
