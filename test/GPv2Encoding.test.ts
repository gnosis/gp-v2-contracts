import { ethers, waffle } from "@nomiclabs/buidler";
import { expect } from "chai";
import { Contract, BigNumber } from "ethers";

import { OrderKind, OrderEncoder } from "../src/ts";

function fillBytes(count: number, byte: number): string {
  return ethers.utils.hexlify([...Array(count)].map(() => byte));
}

function fillUint(bits: number, byte: number): BigNumber {
  return BigNumber.from(fillBytes(bits / 8, byte));
}

describe("GPv2Encoding", () => {
  const [, ...traders] = waffle.provider.getWallets();

  let encoding: Contract;
  let domainSeparator: string;

  beforeEach(async () => {
    const GPv2Encoding = await ethers.getContractFactory(
      "GPv2EncodingTestInterface",
    );

    encoding = await GPv2Encoding.deploy();
    domainSeparator = await encoding.DOMAIN_SEPARATOR();
  });

  describe("decodeSignedOrder", () => {
    it("should round-trip encode executed order data", async () => {
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

      const encoder = new OrderEncoder(domainSeparator);
      encoder.signEncodeOrder(traders[0], order, executedAmount);

      const [decodedOrders] = await encoding.decodeSignedOrdersTest(
        encoder.tokens,
        encoder.orderCount,
        encoder.encodedOrders,
      );

      // NOTE: Ethers.js returns a tuple and not a struct with named fields for
      // `ABIEncoderV2` structs.
      expect(decodedOrders.length).to.equal(1);
      expect(decodedOrders[0]).to.deep.equal([
        await traders[0].getAddress(),
        order.sellToken,
        order.buyToken,
        order.sellAmount,
        order.buyAmount,
        order.validTo,
        order.nonce,
        order.tip,
        order.kind,
        order.partiallyFillable,
        executedAmount,
      ]);
    });

    it("should not allocate memory", async () => {
      // NOTE: We want to make sure that calls to `decodeOrder` does not require
      // additional memory allocations to save on memory per orders.
      //todo
      const encoder = new OrderEncoder(domainSeparator);
      encoder.signEncodeOrder(
        traders[0],
        {
          sellToken: ethers.constants.AddressZero,
          buyToken: ethers.constants.AddressZero,
          sellAmount: ethers.utils.parseEther("42"),
          buyAmount: ethers.utils.parseEther("13.37"),
          validTo: 0xffffffff,
          nonce: 0,
          tip: ethers.constants.WeiPerEther,
          kind: OrderKind.SELL,
          partiallyFillable: false,
        },
        0,
      );

      const [, mem] = await encoding.decodeSignedOrdersTest(
        encoder.tokens,
        encoder.orderCount,
        encoder.encodedOrders,
      );

      // NOTE: Currently, the `ecrecover` call requires 32 bytes of memory to
      // be allocated per call. This is because `STATICCALL` writes the output
      // to memory, and the compiler does not seem to optimize the extra memory
      // copy away (despite the result being saved immediately to memory). In
      // the future, we can optimize this away with some `assembly`.
      expect(mem.toNumber()).to.equal(32);
    });

    it("should revert if order bytes are too short.", async () => {
      await expect(
        encoding.decodeSignedOrdersTest([], 1, "0x1337"),
      ).to.be.revertedWith("malformed order data");
    });

    it("should revert if order bytes are too long.", async () => {
      await expect(
        encoding.decodeSignedOrdersTest(
          [],
          1,
          ethers.utils.hexlify([...Array(205)].map(() => 42)),
        ),
      ).to.be.revertedWith("malformed order data");
    });

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

    it("should revert for invalid order signatures", async () => {
      const encoder = new OrderEncoder(domainSeparator);
      encoder.signEncodeOrder(traders[0], sampleOrder, sampleOrder.sellAmount);

      // NOTE: `v` must be either `27` or `28`, so just set it to something else
      // to generate an invalid signature.
      const encodedOrderBytes = ethers.utils.arrayify(encoder.encodedOrders);
      encodedOrderBytes[139] = 42;

      await expect(
        encoding.decodeSignedOrdersTest(
          encoder.tokens,
          encoder.orderCount,
          encodedOrderBytes,
        ),
      ).to.be.revertedWith("invalid signature");
    });

    it("should revert for invalid sell token indices", async () => {
      const lastToken = fillBytes(20, 0x03);

      const encoder = new OrderEncoder(domainSeparator);
      encoder.signEncodeOrder(traders[0], sampleOrder, sampleOrder.sellAmount);
      encoder.signEncodeOrder(
        traders[1],
        {
          ...sampleOrder,
          sellToken: lastToken,
        },
        sampleOrder.sellAmount,
      );

      // NOTE: Remove the last sell token (0x0303...0303).
      const tokens = encoder.tokens;
      expect(tokens.pop()).to.equal(lastToken);
      await expect(
        encoding.decodeSignedOrdersTest(
          tokens,
          encoder.orderCount,
          encoder.encodedOrders,
        ),
      ).to.be.reverted;
    });

    it("should revert for invalid sell token indices", async () => {
      const lastToken = fillBytes(20, 0x03);

      const encoder = new OrderEncoder(domainSeparator);
      encoder.signEncodeOrder(traders[0], sampleOrder, sampleOrder.sellAmount);
      encoder.signEncodeOrder(
        traders[1],
        {
          ...sampleOrder,
          buyToken: lastToken,
        },
        sampleOrder.sellAmount,
      );

      // NOTE: Remove the last buy token (0x0303...0303).
      const tokens = encoder.tokens;
      expect(tokens.pop()).to.equal(lastToken);
      await expect(
        encoding.decodeSignedOrdersTest(
          tokens,
          encoder.orderCount,
          encoder.encodedOrders,
        ),
      ).to.be.reverted;
    });
  });
});
