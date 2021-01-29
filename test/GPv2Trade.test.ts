import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import {
  EIP1271_MAGICVALUE,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  computeOrderUid,
  hashOrder,
} from "../src/ts";

import { decodeOrder } from "./encoding";

function fillBytes(count: number, byte: number): string {
  return ethers.utils.hexlify([...Array(count)].map(() => byte));
}

function fillUint(bits: number, byte: number): BigNumber {
  return BigNumber.from(fillBytes(bits / 8, byte));
}

describe("GPv2Trade", () => {
  const [deployer, ...traders] = waffle.provider.getWallets();

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

  describe("DOMAIN_SEPARATOR", () => {
    it("should match the test domain hash", async () => {
      expect(await tradeLib.DOMAIN_SEPARATOR()).to.equal(
        ethers.utils._TypedDataEncoder.hashDomain(testDomain),
      );
    });
  });

  describe("recoverTrade", () => {
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

      const { trades } = await tradeLib.recoverTradeTest(
        encoder.tokens,
        encoder.trades,
      );

      expect(trades.length).to.equal(1);

      const { order: abiOrder, executedAmount, feeDiscount } = trades[0];
      expect(decodeOrder(abiOrder)).to.deep.equal(order);
      expect({ executedAmount, feeDiscount }).to.deep.equal(tradeExecution);
    });

    it("should compute order unique identifier", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );

      const { trades } = await tradeLib.recoverTradeTest(
        encoder.tokens,
        encoder.trades,
      );

      const { orderUid } = trades[0];
      expect(orderUid).to.equal(
        computeOrderUid({
          orderDigest: hashOrder(sampleOrder),
          owner: traders[0].address,
          validTo: sampleOrder.validTo,
        }),
      );
    });

    it("should recover signer for all supported schemes", async () => {
      const artifact = await artifacts.readArtifact("EIP1271Verifier");
      const verifier = await waffle.deployMockContract(deployer, artifact.abi);
      await verifier.mock.isValidSignature.returns(EIP1271_MAGICVALUE);

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[1],
        SigningScheme.ETHSIGN,
      );
      encoder.encodeTrade(sampleOrder, {
        scheme: SigningScheme.EIP1271,
        data: {
          verifier: verifier.address,
          signature: "0x",
        },
      });

      const { trades } = await tradeLib.recoverTradeTest(
        encoder.tokens,
        encoder.trades,
      );

      expect(trades[0].owner).to.equal(traders[0].address);
      expect(trades[1].owner).to.equal(traders[1].address);
      expect(trades[2].owner).to.equal(verifier.address);
    });

    it("should revert for invalid sell token indices", async () => {
      const lastToken = fillBytes(20, 0x03);

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );
      await encoder.signEncodeTrade(
        {
          ...sampleOrder,
          sellToken: lastToken,
        },
        traders[1],
        SigningScheme.EIP712,
      );

      // NOTE: Remove the last sell token (0x0303...0303).
      const tokens = encoder.tokens;
      expect(tokens.pop()).to.equal(lastToken);
      await expect(tradeLib.recoverTradeTest(tokens, encoder.trades)).to.be
        .reverted;
    });

    it("should revert for invalid buy token indices", async () => {
      const lastToken = fillBytes(20, 0x03);

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );
      await encoder.signEncodeTrade(
        {
          ...sampleOrder,
          buyToken: lastToken,
        },
        traders[1],
        SigningScheme.EIP712,
      );

      // NOTE: Remove the last buy token (0x0303...0303).
      const tokens = encoder.tokens;
      expect(tokens.pop()).to.equal(lastToken);
      await expect(tradeLib.recoverTradeTest(tokens, encoder.trades)).to.be
        .reverted;
    });

    it("should revert when encoding an invalid signing scheme", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );

      const trades = encoder.trades;
      trades[0].flags |= 0b1100;

      await expect(tradeLib.recoverTradeTest(encoder.tokens, trades)).to.be
        .reverted;
    });

    it("should revert when encoding invalid flags", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );

      const trades = encoder.trades;
      trades[0].flags |= 0b10000;

      await expect(tradeLib.recoverTradeTest(encoder.tokens, trades)).to.be
        .reverted;
    });
  });
});
