import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  OrderBalance,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  encodeOrderFlags,
  encodeSigningScheme,
} from "../src/ts";

import {
  OrderBalanceId,
  decodeOrderKind,
  decodeOrderBalance,
  decodeOrder,
} from "./encoding";

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
        sellTokenBalance: OrderBalance.EXTERNAL,
        buyTokenBalance: OrderBalance.INTERNAL,
      };
      const tradeExecution = {
        executedAmount: fillUint(256, 0x09),
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
      const flagVariants = [OrderKind.SELL, OrderKind.BUY].flatMap((kind) =>
        [false, true].flatMap((partiallyFillable) =>
          [
            OrderBalance.ERC20,
            OrderBalance.EXTERNAL,
            OrderBalance.INTERNAL,
          ].flatMap((sellTokenBalance) =>
            [OrderBalance.ERC20, OrderBalance.INTERNAL].map(
              (buyTokenBalance) => ({
                kind,
                partiallyFillable,
                sellTokenBalance,
                buyTokenBalance,
              }),
            ),
          ),
        ),
      );

      for (const flags of flagVariants) {
        const {
          kind: encodedKind,
          partiallyFillable,
          sellTokenBalance: encodedSellTokenBalance,
          buyTokenBalance: encodedBuyTokenBalance,
        } = await tradeLib.extractFlagsTest(encodeOrderFlags(flags));
        expect({
          kind: decodeOrderKind(encodedKind),
          partiallyFillable,
          sellTokenBalance: decodeOrderBalance(encodedSellTokenBalance),
          buyTokenBalance: decodeOrderBalance(encodedBuyTokenBalance),
        }).to.deep.equal(flags);
      }
    });

    it("should accept 0b00 and 0b01 for ERC20 sell token balance flag", async () => {
      for (const encodedFlags of [0b00000, 0b00100]) {
        const { sellTokenBalance } = await tradeLib.extractFlagsTest(
          encodedFlags,
        );
        expect(sellTokenBalance).to.equal(OrderBalanceId.ERC20);
      }
    });

    it("should extract all supported signing schemes", async () => {
      for (const scheme of [
        SigningScheme.EIP712,
        SigningScheme.ETHSIGN,
        SigningScheme.EIP1271,
        SigningScheme.PRESIGN,
      ]) {
        const { signingScheme: extractedScheme } =
          await tradeLib.extractFlagsTest(encodeSigningScheme(scheme));
        expect(extractedScheme).to.deep.equal(scheme);
      }
    });

    it("should revert when encoding invalid flags", async () => {
      await expect(tradeLib.extractFlagsTest(0b10000000)).to.be.reverted;
    });
  });
});
