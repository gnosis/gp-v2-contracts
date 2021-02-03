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
  eip1271Message,
} from "../src/ts";

import { decodeOrder } from "./encoding";

function fillBytes(count: number, byte: number): string {
  return ethers.utils.hexlify([...Array(count)].map(() => byte));
}

function fillUint(bits: number, byte: number): BigNumber {
  return BigNumber.from(fillBytes(bits / 8, byte));
}

describe("GPv2Trade+GPv2Signing", () => {
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

  let signing: Contract;

  beforeEach(async () => {
    const GPv2Signing = await ethers.getContractFactory(
      "GPv2SigningTestInterface",
    );

    signing = await GPv2Signing.deploy();
  });

  describe("DOMAIN_SEPARATOR", () => {
    it("should match the test domain hash", async () => {
      expect(await signing.DOMAIN_SEPARATOR()).to.equal(
        ethers.utils._TypedDataEncoder.hashDomain(testDomain),
      );
    });
  });

  describe("recoverOrderFromTrade", () => {
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

      const { recoveredOrders } = await signing.recoverOrdersFromTradesTest(
        encoder.tokens,
        encoder.trades,
      );

      expect(recoveredOrders.length).to.equal(1);
      // NOTE: Ethers.js returns a tuple and not a struct with named fields for
      // `abicoder v2` nested structs.
      expect(decodeOrder(recoveredOrders[0].data)).to.deep.equal(order);
    });

    it("should compute order unique identifier", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );

      const { recoveredOrders } = await signing.recoverOrdersFromTradesTest(
        encoder.tokens,
        encoder.trades,
      );

      const { uid: orderUid } = recoveredOrders[0];
      expect(orderUid).to.equal(
        computeOrderUid({
          orderDigest: hashOrder(sampleOrder),
          owner: traders[0].address,
          validTo: sampleOrder.validTo,
        }),
      );
    });

    it("should recover signing address for all supported ECDSA-based schemes", async () => {
      const encoder = new SettlementEncoder(testDomain);
      for (const scheme of [
        SigningScheme.EIP712,
        SigningScheme.ETHSIGN,
      ] as const) {
        await encoder.signEncodeTrade(sampleOrder, traders[0], scheme);
      }

      const { recoveredOrders } = await signing.recoverOrdersFromTradesTest(
        encoder.tokens,
        encoder.trades,
      );

      const traderAddress = await traders[0].getAddress();
      for (const decodedTrade of recoveredOrders) {
        const { owner } = decodedTrade;
        expect(owner).to.equal(traderAddress);
      }
    });

    it("should revert for invalid eip-712 order signatures", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );

      // NOTE: `v` must be either `27` or `28`, so just set it to something else
      // to generate an invalid signature.
      const trades = encoder.trades;
      const signature = ethers.utils.arrayify(trades[0].signature);
      signature[64] = 42;
      trades[0].signature = signature;

      await expect(
        signing.recoverOrdersFromTradesTest(encoder.tokens, trades),
      ).to.be.revertedWith("invalid eip712 signature");
    });

    it("should revert for invalid ethsign order signatures", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.ETHSIGN,
      );

      // NOTE: `v` must be either `27` or `28`, so just set it to something else
      // to generate an invalid signature.
      const trades = encoder.trades;
      const signature = ethers.utils.arrayify(trades[0].signature);
      signature[64] = 42;
      trades[0].signature = signature;

      await expect(
        signing.recoverOrdersFromTradesTest(encoder.tokens, trades),
      ).to.be.revertedWith("invalid ethsign signature");
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
      await expect(signing.recoverOrdersFromTradesTest(tokens, encoder.trades))
        .to.be.reverted;
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
      await expect(signing.recoverOrdersFromTradesTest(tokens, encoder.trades))
        .to.be.reverted;
    });

    it("should verify EIP-1271 contract signatures by returning owner", async () => {
      const artifact = await artifacts.readArtifact("EIP1271Verifier");
      const verifier = await waffle.deployMockContract(deployer, artifact.abi);

      const message = eip1271Message(testDomain, sampleOrder);
      const eip1271Signature = "0x031337";
      await verifier.mock.isValidSignature
        .withArgs(message, eip1271Signature)
        .returns(EIP1271_MAGICVALUE);

      const encoder = new SettlementEncoder(testDomain);
      encoder.encodeTrade(sampleOrder, {
        scheme: SigningScheme.EIP1271,
        data: {
          verifier: verifier.address,
          signature: eip1271Signature,
        },
      });

      const { recoveredOrders } = await signing.recoverOrdersFromTradesTest(
        encoder.tokens,
        encoder.trades,
      );

      expect(recoveredOrders.length).to.equal(1);
      const { owner } = recoveredOrders[0];
      expect(owner).to.equal(verifier.address);
    });

    it("should revert on an invalid EIP-1271 signature", async () => {
      const message = eip1271Message(testDomain, sampleOrder);
      const eip1271Signature = "0x031337";

      const artifact = await artifacts.readArtifact("EIP1271Verifier");
      const verifier1 = await waffle.deployMockContract(deployer, artifact.abi);

      await verifier1.mock.isValidSignature
        .withArgs(message, eip1271Signature)
        .returns("0xbaadc0d3");

      const encoder1 = new SettlementEncoder(testDomain);
      encoder1.encodeTrade(sampleOrder, {
        scheme: SigningScheme.EIP1271,
        data: {
          verifier: verifier1.address,
          signature: eip1271Signature,
        },
      });

      await expect(
        signing.recoverOrdersFromTradesTest(encoder1.tokens, encoder1.trades),
      ).to.be.revertedWith("invalid eip1271 signature");

      const NON_STANDARD_EIP1271_VERIFIER = [
        "function isValidSignature(bytes32 _hash, bytes memory _signature)",
      ]; // no return value
      const verifier2 = await waffle.deployMockContract(
        deployer,
        NON_STANDARD_EIP1271_VERIFIER,
      );

      await verifier2.mock.isValidSignature
        .withArgs(message, eip1271Signature)
        .returns();

      const encoder2 = new SettlementEncoder(testDomain);
      encoder2.encodeTrade(sampleOrder, {
        scheme: SigningScheme.EIP1271,
        data: {
          verifier: verifier2.address,
          signature: eip1271Signature,
        },
      });

      // Transaction reverted: function returned an unexpected amount of data
      await expect(
        signing.recoverOrdersFromTradesTest(encoder2.tokens, encoder2.trades),
      ).to.be.reverted;
    });

    it("should revert for EIP-1271 signatures from externally owned accounts", async () => {
      const encoder = new SettlementEncoder(testDomain);
      encoder.encodeTrade(sampleOrder, {
        scheme: SigningScheme.EIP1271,
        data: {
          verifier: traders[0].address,
          signature: "0x00",
        },
      });

      // Transaction reverted: function call to a non-contract account
      await expect(
        signing.recoverOrdersFromTradesTest(encoder.tokens, encoder.trades),
      ).to.be.reverted;
    });

    it("should revert if the EIP-1271 verification function changes the state", async () => {
      const StateChangingEIP1271 = await ethers.getContractFactory(
        "StateChangingEIP1271",
      );

      const evilVerifier = await StateChangingEIP1271.deploy();
      const message = eip1271Message(testDomain, sampleOrder);
      const eip1271Signature = "0x";

      expect(await evilVerifier.state()).to.deep.equal(ethers.constants.Zero);
      await evilVerifier.isValidSignature(message, eip1271Signature);
      expect(await evilVerifier.state()).to.deep.equal(ethers.constants.One);
      expect(
        await evilVerifier.callStatic.isValidSignature(
          message,
          eip1271Signature,
        ),
      ).to.equal(EIP1271_MAGICVALUE);

      const encoder = new SettlementEncoder(testDomain);
      encoder.encodeTrade(sampleOrder, {
        scheme: SigningScheme.EIP1271,
        data: {
          verifier: evilVerifier.address,
          signature: eip1271Signature,
        },
      });

      // Transaction reverted and Hardhat couldn't infer the reason.
      await expect(
        signing.recoverOrdersFromTradesTest(encoder.tokens, encoder.trades),
      ).to.be.reverted;
      expect(await evilVerifier.state()).to.deep.equal(ethers.constants.One);
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

      await expect(signing.recoverOrdersFromTradesTest(encoder.tokens, trades))
        .to.be.reverted;
    });

    it("should not allocate additional memory", async () => {
      // NOTE: We want to make sure that calls to `decodeOrder` does not require
      // additional memory allocations to save on memory per orders.
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

      const { mem } = await signing.recoverOrdersFromTradesTest(
        encoder.tokens,
        encoder.trades,
      );
      expect(mem.toNumber()).to.equal(0);
    });

    describe("uid uniqueness", () => {
      it("invalid EVM transaction encoding does not change order hash", async () => {
        // The variables for an EVM transaction are encoded in multiples of 32
        // bytes for all types except `string` and `bytes`. This extra padding
        // is usually filled with zeroes by the library that creates the
        // transaction. It can however be manually messed with, still producing
        // a valid transaction.
        // Computing GPv2's orderUid requires copying 32-byte-encoded addresses
        // from calldata to memory (buy and sell tokens), which are then hashed
        // together with the rest of the order. This copying procedure may keep
        // the padding bytes as they are in the (manipulated) calldata, since
        // Solidity does not make any guarantees on the padding bits of a
        // variable during execution. If these 12 padding bits were not zero
        // after copying, then the same order would end up with two different
        // uids. This test shows that this is not the case.

        const encoder = new SettlementEncoder(testDomain);
        await encoder.signEncodeTrade(
          sampleOrder,
          traders[0],
          SigningScheme.EIP712,
        );

        const { recoveredOrders } = await signing.recoverOrdersFromTradesTest(
          encoder.tokens,
          encoder.trades,
        );

        const { uid: orderUid } = recoveredOrders[0];
        const encodedTransactionData = ethers.utils.arrayify(
          signing.interface.encodeFunctionData("recoverOrdersFromTradesTest", [
            encoder.tokens,
            encoder.trades,
          ]),
        );

        // calldata encoding:
        //  -  4 bytes: signature
        //  - 32 bytes: pointer to first input value
        //  - 32 bytes: pointer to second input value
        //  - 32 bytes: first input value, array -> token array length
        //  - 32 bytes: first token address
        const encodedNumTokens = BigNumber.from(
          encodedTransactionData.slice(4 + 2 * 32, 4 + 3 * 32),
        );
        expect(encodedNumTokens).to.equal(2);
        const startTokenWord = 4 + 3 * 32;
        const encodedFirstToken = encodedTransactionData.slice(
          startTokenWord,
          startTokenWord + 32,
        );
        expect(encodedFirstToken.slice(0, 12).every((byte) => byte === 0)).to.be
          .true;
        expect(ethers.utils.hexlify(encodedFirstToken.slice(-20))).to.equal(
          encoder.tokens[0],
        );

        for (let i = startTokenWord; i < startTokenWord + 12; i++) {
          encodedTransactionData[i] = 42;
        }
        const encodedOutput = await ethers.provider.call({
          data: ethers.utils.hexlify(encodedTransactionData),
          to: signing.address,
        });
        expect(encodedOutput).to.contain(orderUid.slice(2));
      });
    });
  });
});
