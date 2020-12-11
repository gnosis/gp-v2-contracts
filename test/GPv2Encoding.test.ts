import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  ORDER_TYPE_HASH,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  computeOrderUid,
  extractOrderUidParams,
  hashOrder,
} from "../src/ts";

import { decodeTrade } from "./encoding";

function fillBytes(count: number, byte: number): string {
  return ethers.utils.hexlify([...Array(count)].map(() => byte));
}

function fillDistinctBytes(count: number, start: number): string {
  return ethers.utils.hexlify(
    [...Array(count)].map((_, i) => (start + i) % 256),
  );
}

function fillUint(bits: number, byte: number): BigNumber {
  return BigNumber.from(fillBytes(bits / 8, byte));
}

describe("GPv2Encoding", () => {
  const [, ...traders] = waffle.provider.getWallets();

  const testDomain = { name: "test" };
  const sampleOrder = {
    sellToken: fillBytes(20, 0x01),
    buyToken: fillBytes(20, 0x02),
    sellAmount: ethers.utils.parseEther("42"),
    buyAmount: ethers.utils.parseEther("13.37"),
    validTo: 0xffffffff,
    appData: 0,
    feeAmount: ethers.utils.parseEther("1.0"),
    kind: OrderKind.SELL,
    partiallyFillable: false,
  };

  let encoding: Contract;

  beforeEach(async () => {
    const GPv2Encoding = await ethers.getContractFactory(
      "GPv2EncodingTestInterface",
    );

    encoding = await GPv2Encoding.deploy();
  });

  describe("DOMAIN_SEPARATOR", () => {
    it("should match the test domain hash", async () => {
      expect(await encoding.DOMAIN_SEPARATOR()).to.equal(
        ethers.utils._TypedDataEncoder.hashDomain(testDomain),
      );
    });
  });

  describe("ORDER_TYPE_HASH", () => {
    it("should be match the EIP-712 order type hash", async () => {
      expect(await encoding.orderTypeHashTest()).to.equal(ORDER_TYPE_HASH);
    });
  });

  describe("tradeCount", () => {
    it("should compute the number of encoded trades", async () => {
      const tradeCount = 10;
      const encoder = new SettlementEncoder(testDomain);
      for (let i = 0; i < tradeCount; i++) {
        await encoder.signEncodeTrade(
          { ...sampleOrder, appData: i },
          traders[0],
          SigningScheme.TYPED_DATA,
        );
      }

      expect(encoder.tradeCount).to.equal(tradeCount);
      expect(await encoding.tradeCountTest(encoder.encodedTrades)).to.equal(
        tradeCount,
      );
    });

    it("should revert if trade bytes are too short.", async () => {
      await expect(encoding.tradeCountTest("0x1337")).to.be.revertedWith(
        "malformed trade data",
      );
    });

    it("should revert if trade bytes are too long.", async () => {
      await expect(
        encoding.tradeCountTest(
          ethers.utils.hexlify([...Array(205)].map(() => 42)),
        ),
      ).to.be.revertedWith("malformed trade data");
    });
  });

  describe("decodeTrade", () => {
    it("should round-trip encode order data", async () => {
      // NOTE: Pay extra attention to use all bytes for each field, and that
      // they all have different values to make sure the are correctly
      // round-tripped.
      const order = {
        sellToken: fillBytes(20, 0x01),
        buyToken: fillBytes(20, 0x02),
        sellAmount: fillUint(256, 0x03),
        buyAmount: fillUint(256, 0x04),
        validTo: fillUint(32, 0x05).toNumber(),
        appData: fillUint(32, 0x06).toNumber(),
        feeAmount: fillUint(256, 0x07),
        kind: OrderKind.BUY,
        partiallyFillable: true,
      };
      const tradeExecution = {
        executedAmount: fillUint(256, 0x08),
        feeDiscount: fillUint(16, 0x09).toNumber(),
      };

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        order,
        traders[0],
        SigningScheme.TYPED_DATA,
        tradeExecution,
      );

      const [decodedTrades] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );

      // NOTE: Ethers.js returns a tuple and not a struct with named fields for
      // `abicoder v2` structs.
      expect(decodedTrades.length).to.equal(1);

      const { order: decodedOrder, executedAmount, feeDiscount } = decodeTrade(
        decodedTrades[0],
      );
      expect(decodedOrder).to.deep.equal(order);
      expect({ executedAmount, feeDiscount }).to.deep.equal(tradeExecution);
    });

    it("should return order token indices", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const [decodedTrades] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );
      const { sellTokenIndex, buyTokenIndex } = decodeTrade(decodedTrades[0]);
      expect(sellTokenIndex).to.equal(
        encoder.tokens.indexOf(sampleOrder.sellToken),
      );
      expect(buyTokenIndex).to.equal(
        encoder.tokens.indexOf(sampleOrder.buyToken),
      );
    });

    it("should compute EIP-712 order struct hash", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const [decodedTrades] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );

      const { orderDigest } = extractOrderUidParams(
        decodeTrade(decodedTrades[0]).orderUid,
      );
      expect(orderDigest).to.equal(hashOrder(sampleOrder));
    });

    it("should compute order unique identifier", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const [decodedTrades] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );

      const { orderUid } = decodeTrade(decodedTrades[0]);
      expect(orderUid).to.equal(
        computeOrderUid({
          orderDigest: hashOrder(sampleOrder),
          owner: traders[0].address,
          validTo: sampleOrder.validTo,
        }),
      );
    });

    it("should recover signing address for all supported schemes", async () => {
      const encoder = new SettlementEncoder(testDomain);
      for (const scheme of [SigningScheme.TYPED_DATA, SigningScheme.MESSAGE]) {
        await encoder.signEncodeTrade(sampleOrder, traders[0], scheme);
      }

      const [decodedTrades] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );

      const traderAddress = await traders[0].getAddress();
      for (const decodedTrade of decodedTrades) {
        const { owner } = decodeTrade(decodedTrade);
        expect(owner).to.equal(traderAddress);
      }
    });

    it("should revert for invalid order signatures", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      // NOTE: `v` must be either `27` or `28`, so just set it to something else
      // to generate an invalid signature.
      const encodedTradeBytes = ethers.utils.arrayify(encoder.encodedTrades);
      encodedTradeBytes[141] = 42;

      await expect(
        encoding.decodeTradesTest(encoder.tokens, encodedTradeBytes),
      ).to.be.revertedWith("invalid signature");
    });

    it("should revert for invalid sell token indices", async () => {
      const lastToken = fillBytes(20, 0x03);

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.TYPED_DATA,
      );
      await encoder.signEncodeTrade(
        {
          ...sampleOrder,
          sellToken: lastToken,
        },
        traders[1],
        SigningScheme.TYPED_DATA,
      );

      // NOTE: Remove the last sell token (0x0303...0303).
      const tokens = encoder.tokens;
      expect(tokens.pop()).to.equal(lastToken);
      await expect(encoding.decodeTradesTest(tokens, encoder.encodedTrades)).to
        .be.reverted;
    });

    it("should revert for invalid sell token indices", async () => {
      const lastToken = fillBytes(20, 0x03);

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.TYPED_DATA,
      );
      await encoder.signEncodeTrade(
        {
          ...sampleOrder,
          buyToken: lastToken,
        },
        traders[1],
        SigningScheme.TYPED_DATA,
      );

      // NOTE: Remove the last buy token (0x0303...0303).
      const tokens = encoder.tokens;
      expect(tokens.pop()).to.equal(lastToken);
      await expect(encoding.decodeTradesTest(tokens, encoder.encodedTrades)).to
        .be.reverted;
    });

    it("should not allocate additional memory", async () => {
      // NOTE: We want to make sure that calls to `decodeOrder` does not require
      // additional memory allocations to save on memory per orders.
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.TYPED_DATA,
      );
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[1],
        SigningScheme.MESSAGE,
      );

      const [, mem] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );
      expect(mem.toNumber()).to.equal(0);
    });
  });

  describe("extractOrderUidParams", () => {
    it("round trip encode/decode", async () => {
      // Start from 17 (0x11) so that the first byte has no zeroes.
      const orderDigest = fillDistinctBytes(32, 17);
      const address = ethers.utils.getAddress(fillDistinctBytes(20, 17 + 32));
      const validTo = BigNumber.from(fillDistinctBytes(4, 17 + 32 + 20));

      const orderUid = computeOrderUid({
        orderDigest,
        owner: address,
        validTo: validTo.toNumber(),
      });
      expect(orderUid).to.equal(fillDistinctBytes(32 + 20 + 4, 17));

      const {
        orderDigest: extractedOrderDigest,
        owner: extractedAddress,
        validTo: extractedValidTo,
      } = await encoding.extractOrderUidParamsTest(orderUid);
      expect(extractedOrderDigest).to.equal(orderDigest);
      expect(extractedValidTo).to.equal(validTo);
      expect(extractedAddress).to.equal(address);
    });

    describe("fails on uid", () => {
      const uidStride = 32 + 20 + 4;

      it("longer than expected", async () => {
        const invalidUid = "0x" + "00".repeat(uidStride + 1);

        await expect(
          encoding.extractOrderUidParamsTest(invalidUid),
        ).to.be.revertedWith("GPv2: invalid uid");
      });

      it("shorter than expected", async () => {
        const invalidUid = "0x" + "00".repeat(uidStride - 1);

        await expect(
          encoding.extractOrderUidParamsTest(invalidUid),
        ).to.be.revertedWith("GPv2: invalid uid");
      });
    });
  });
});
