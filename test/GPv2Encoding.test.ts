import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  ORDER_TYPE_HASH,
  Order,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  hashOrder,
} from "../src/ts";

function fillBytes(count: number, byte: number): string {
  return ethers.utils.hexlify([...Array(count)].map(() => byte));
}

function fillUint(bits: number, byte: number): BigNumber {
  return BigNumber.from(fillBytes(bits / 8, byte));
}

interface Trade {
  order: Order;
  sellTokenIndex: number;
  buyTokenIndex: number;
  executedAmount: BigNumber;
  digest: string;
  owner: string;
}

function parseTrade(trade: unknown[]): Trade {
  const order = trade[0] as unknown[];
  return {
    order: {
      sellToken: order[0] as string,
      buyToken: order[1] as string,
      sellAmount: order[2] as BigNumber,
      buyAmount: order[3] as BigNumber,
      validTo: order[4] as number,
      nonce: order[5] as number,
      tip: order[6] as BigNumber,
      kind: order[7] as OrderKind,
      partiallyFillable: order[8] as boolean,
    },
    sellTokenIndex: trade[1] as number,
    buyTokenIndex: trade[2] as number,
    executedAmount: trade[3] as BigNumber,
    digest: trade[4] as string,
    owner: trade[5] as string,
  };
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
    nonce: 0,
    tip: ethers.constants.WeiPerEther,
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
        nonce: fillUint(32, 0x06).toNumber(),
        tip: fillUint(256, 0x07),
        kind: OrderKind.BUY,
        partiallyFillable: true,
      };
      const executedAmount = fillUint(256, 0x08);

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        order,
        executedAmount,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const [decodedTrades] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.tradeCount,
        encoder.encodedTrades,
      );

      // NOTE: Ethers.js returns a tuple and not a struct with named fields for
      // `ABIEncoderV2` structs.
      expect(decodedTrades.length).to.equal(1);

      const {
        order: decodedOrder,
        executedAmount: decodedExecutedAmount,
      } = parseTrade(decodedTrades[0]);
      expect(decodedOrder).to.deep.equal(order);
      expect(decodedExecutedAmount).to.deep.equal(executedAmount);
    });

    it("should return order token indices", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        0,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const [decodedTrades] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.tradeCount,
        encoder.encodedTrades,
      );
      const { sellTokenIndex, buyTokenIndex } = parseTrade(decodedTrades[0]);
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
        0,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      const [decodedTrades] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.tradeCount,
        encoder.encodedTrades,
      );
      const { digest } = parseTrade(decodedTrades[0]);
      expect(digest).to.equal(hashOrder(sampleOrder));
    });

    it("should recover signing address for all supported schemes", async () => {
      const encoder = new SettlementEncoder(testDomain);
      for (const scheme of [SigningScheme.TYPED_DATA, SigningScheme.MESSAGE]) {
        await encoder.signEncodeTrade(sampleOrder, 0, traders[0], scheme);
      }

      const [decodedTrades] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.tradeCount,
        encoder.encodedTrades,
      );

      const traderAddress = await traders[0].getAddress();
      for (const decodedTrade of decodedTrades) {
        const { owner } = parseTrade(decodedTrade);
        expect(owner).to.equal(traderAddress);
      }
    });

    it("should revert if trade bytes are too short.", async () => {
      await expect(
        encoding.decodeTradesTest([], 1, "0x1337"),
      ).to.be.revertedWith("malformed trade data");
    });

    it("should revert if trade bytes are too long.", async () => {
      await expect(
        encoding.decodeTradesTest(
          [],
          1,
          ethers.utils.hexlify([...Array(205)].map(() => 42)),
        ),
      ).to.be.revertedWith("malformed trade data");
    });

    it("should revert for invalid order signatures", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        sampleOrder.sellAmount,
        traders[0],
        SigningScheme.TYPED_DATA,
      );

      // NOTE: `v` must be either `27` or `28`, so just set it to something else
      // to generate an invalid signature.
      const encodedOrderBytes = ethers.utils.arrayify(encoder.encodedTrades);
      encodedOrderBytes[139] = 42;

      await expect(
        encoding.decodeTradesTest(
          encoder.tokens,
          encoder.tradeCount,
          encodedOrderBytes,
        ),
      ).to.be.revertedWith("invalid signature");
    });

    it("should revert for invalid sell token indices", async () => {
      const lastToken = fillBytes(20, 0x03);

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        sampleOrder.sellAmount,
        traders[0],
        SigningScheme.TYPED_DATA,
      );
      await encoder.signEncodeTrade(
        {
          ...sampleOrder,
          sellToken: lastToken,
        },
        sampleOrder.sellAmount,
        traders[1],
        SigningScheme.TYPED_DATA,
      );

      // NOTE: Remove the last sell token (0x0303...0303).
      const tokens = encoder.tokens;
      expect(tokens.pop()).to.equal(lastToken);
      await expect(
        encoding.decodeTradesTest(
          tokens,
          encoder.tradeCount,
          encoder.encodedTrades,
        ),
      ).to.be.reverted;
    });

    it("should revert for invalid sell token indices", async () => {
      const lastToken = fillBytes(20, 0x03);

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        sampleOrder.sellAmount,
        traders[0],
        SigningScheme.TYPED_DATA,
      );
      await encoder.signEncodeTrade(
        {
          ...sampleOrder,
          buyToken: lastToken,
        },
        sampleOrder.sellAmount,
        traders[1],
        SigningScheme.TYPED_DATA,
      );

      // NOTE: Remove the last buy token (0x0303...0303).
      const tokens = encoder.tokens;
      expect(tokens.pop()).to.equal(lastToken);
      await expect(
        encoding.decodeTradesTest(
          tokens,
          encoder.tradeCount,
          encoder.encodedTrades,
        ),
      ).to.be.reverted;
    });

    it("should not allocate additional memory", async () => {
      // NOTE: We want to make sure that calls to `decodeOrder` does not require
      // additional memory allocations to save on memory per orders.
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        0,
        traders[0],
        SigningScheme.TYPED_DATA,
      );
      await encoder.signEncodeTrade(
        sampleOrder,
        0,
        traders[1],
        SigningScheme.MESSAGE,
      );

      const [, mem] = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.tradeCount,
        encoder.encodedTrades,
      );
      expect(mem.toNumber()).to.equal(0);
    });
  });
});
