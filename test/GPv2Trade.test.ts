import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  encodeOrderFlags,
  encodeSigningScheme,
} from "../src/ts";

import { decodeOrderKind, decodeOrder } from "./encoding";

function fillBytes(count: number, byte: number): string {
  return ethers.utils.hexlify([...Array(count)].map(() => byte));
}

function fillUint(bits: number, byte: number): BigNumber {
  return BigNumber.from(fillBytes(bits / 8, byte));
}

describe("GPv2Trade", () => {
  const [, ...traders] = waffle.provider.getWallets();

  const testDomain = { name: "test" };
  const sampleOrder = {
    sellToken: fillBytes(20, 0x01),
    buyToken: fillBytes(20, 0x02),
    receiver: fillBytes(20, 0x03),
    sellAmount: ethers.utils.parseEther("42"),
    buyAmount: ethers.utils.parseEther("13.37"),
    validTo: 0xffffffff,
    appData: ethers.constants.HashZero,
    feeAmount: ethers.utils.parseEther("1.0"),
    kind: OrderKind.SELL,
    partiallyFillable: false,
  };

  let tradeLib: Contract;

  beforeEach(async () => {
    const GPv2Trade = await ethers.getContractFactory("GPv2TradeTestInterface");

    tradeLib = await GPv2Trade.deploy();
  });

  describe("extractOrder", () => {
    it("should round-trip encode order data", async () => {
      // NOTE: Pay extra attention to use all bytes for each field, and that
      // they all have different values to make sure the are correctly
      // round-tripped.
      const order = {
        sellToken: fillBytes(20, 0x01),
        buyToken: fillBytes(20, 0x02),
        receiver: fillBytes(20, 0x03),
        sellAmount: fillUint(256, 0x04),
        buyAmount: fillUint(256, 0x05),
        validTo: fillUint(32, 0x06).toNumber(),
        appData: fillBytes(32, 0x07),
        feeAmount: fillUint(256, 0x08),
        kind: OrderKind.BUY,
        partiallyFillable: true,
      };
      const tradeExecution = {
        executedAmount: fillUint(256, 0x09),
        feeDiscount: fillUint(256, 0x0a),
      };

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        order,
        traders[0],
        SigningScheme.EIP712,
        tradeExecution,
      );

      const encodedOrder = await tradeLib.extractOrderTest(
        encoder.tokens,
        encoder.trades[0],
      );
      expect(decodeOrder(encodedOrder)).to.deep.equal(order);
    });

    it("should revert for invalid sell token indices", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[1],
        SigningScheme.EIP712,
      );

      const tokens = encoder.tokens.filter(
        (token) => token !== sampleOrder.sellToken,
      );
      await expect(tradeLib.extractOrderTest(tokens, encoder.trades)).to.be
        .reverted;
    });

    it("should revert for invalid buy token indices", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[1],
        SigningScheme.EIP712,
      );

      const tokens = encoder.tokens.filter(
        (token) => token !== sampleOrder.buyToken,
      );
      await expect(tradeLib.extractOrderTest(tokens, encoder.trades)).to.be
        .reverted;
    });
  });

  describe("extractFlags", () => {
    it("should extract all supported order flags", async () => {
      for (const flags of [
        { kind: OrderKind.SELL, partiallyFillable: false },
        { kind: OrderKind.BUY, partiallyFillable: false },
        { kind: OrderKind.SELL, partiallyFillable: true },
        { kind: OrderKind.BUY, partiallyFillable: true },
      ]) {
        const {
          kind: encodedKind,
          partiallyFillable,
        } = await tradeLib.extractFlagsTest(encodeOrderFlags(flags));
        expect({
          kind: decodeOrderKind(encodedKind),
          partiallyFillable,
        }).to.deep.equal(flags);
      }
    });

    it("should extract all supported signing schemes", async () => {
      for (const scheme of [
        SigningScheme.EIP712,
        SigningScheme.ETHSIGN,
        SigningScheme.EIP1271,
      ]) {
        const {
          signingScheme: extractedScheme,
        } = await tradeLib.extractFlagsTest(encodeSigningScheme(scheme));
        expect(extractedScheme).to.deep.equal(scheme);
      }
    });

    it("should revert when encoding an invalid signing scheme", async () => {
      await expect(tradeLib.extractFlagsTest(0b1100)).to.be.reverted;
    });

    it("should revert when encoding invalid flags", async () => {
      await expect(tradeLib.extractFlagsTest(0b10000)).to.be.reverted;
    });
  });
});
