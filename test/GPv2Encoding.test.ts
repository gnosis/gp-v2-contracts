import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import {
  EIP1271_MAGICVALUE,
  ORDER_TYPE_HASH,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  computeOrderUid,
  extractOrderUidParams,
  hashOrder,
  packInteractions,
  eip1271Message,
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
  const [, deployer, ...traders] = waffle.provider.getWallets();

  const testDomain = { name: "test" };
  const sampleOrder = {
    sellToken: fillBytes(20, 0x01),
    buyToken: fillBytes(20, 0x02),
    receiver: fillBytes(20, 0x03),
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
          SigningScheme.EIP712,
        );
      }

      expect(encoder.tradeCount).to.equal(tradeCount);
      const [computedTradeCount] = await encoding.tradeCountTest(
        encoder.encodedTrades,
      );
      expect(computedTradeCount).to.deep.equal(tradeCount);
    });

    it("should return the calldata storing encoded trades", async () => {
      const tradeCount = 10;
      const encoder = new SettlementEncoder(testDomain);
      for (let i = 0; i < tradeCount; i++) {
        await encoder.signEncodeTrade(
          { ...sampleOrder, appData: i },
          traders[0],
          SigningScheme.EIP712,
        );
      }

      const [, encodedTrades] = await encoding.tradeCountTest(
        encoder.encodedTrades,
      );
      expect(encodedTrades).to.equal("0x" + encoder.encodedTrades.slice(6));
    });

    it("should revert if length is not specified", async () => {
      await expect(encoding.tradeCountTest("0x")).to.be.revertedWith(
        "GPv2: malformed trade data",
      );
      await expect(encoding.tradeCountTest("0x00")).to.be.revertedWith(
        "GPv2: malformed trade data",
      );
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
        receiver: fillBytes(20, 0x03),
        sellAmount: fillUint(256, 0x04),
        buyAmount: fillUint(256, 0x05),
        validTo: fillUint(32, 0x06).toNumber(),
        appData: fillUint(32, 0x07).toNumber(),
        feeAmount: fillUint(256, 0x08),
        kind: OrderKind.BUY,
        partiallyFillable: true,
      };
      const tradeExecution = {
        executedAmount: fillUint(256, 0x09),
        feeDiscount: fillUint(16, 0x0a).toNumber(),
      };

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        order,
        traders[0],
        SigningScheme.EIP712,
        tradeExecution,
      );

      const { trades } = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );

      // NOTE: Ethers.js returns a tuple and not a struct with named fields for
      // `abicoder v2` structs.
      expect(trades.length).to.equal(1);

      const { order: decodedOrder, executedAmount, feeDiscount } = decodeTrade(
        trades[0],
      );
      expect(decodedOrder).to.deep.equal(order);
      expect({ executedAmount, feeDiscount }).to.deep.equal(tradeExecution);
    });

    it("should return order token indices", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );

      const { trades } = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );
      const { sellTokenIndex, buyTokenIndex } = decodeTrade(trades[0]);
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
        SigningScheme.EIP712,
      );

      const { trades } = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );

      const { orderDigest } = extractOrderUidParams(
        decodeTrade(trades[0]).orderUid,
      );
      expect(orderDigest).to.equal(hashOrder(sampleOrder));
    });

    it("should compute order unique identifier", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        sampleOrder,
        traders[0],
        SigningScheme.EIP712,
      );

      const { trades } = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );

      const { orderUid } = decodeTrade(trades[0]);
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
      for (const scheme of [SigningScheme.EIP712, SigningScheme.ETHSIGN]) {
        await encoder.signEncodeTrade(sampleOrder, traders[0], scheme);
      }

      const { trades } = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );

      const traderAddress = await traders[0].getAddress();
      for (const decodedTrade of trades) {
        const { owner } = decodeTrade(decodedTrade);
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
      const encodedTradeBytes = ethers.utils.arrayify(encoder.encodedTrades);
      encodedTradeBytes[227] = 42;

      await expect(
        encoding.decodeTradesTest(encoder.tokens, encodedTradeBytes),
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
      const encodedTradeBytes = ethers.utils.arrayify(encoder.encodedTrades);
      encodedTradeBytes[227] = 42;

      await expect(
        encoding.decodeTradesTest(encoder.tokens, encodedTradeBytes),
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
      await expect(encoding.decodeTradesTest(tokens, encoder.encodedTrades)).to
        .be.reverted;
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
      await expect(encoding.decodeTradesTest(tokens, encoder.encodedTrades)).to
        .be.reverted;
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
      encoder.encodeContractTrade(
        sampleOrder,
        verifier.address,
        eip1271Signature,
      );

      const { trades } = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );

      expect(trades.length).to.equal(1);
      const { owner } = decodeTrade(trades[0]);
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
      encoder1.encodeContractTrade(
        sampleOrder,
        verifier1.address,
        eip1271Signature,
      );
      await expect(
        encoding.decodeTradesTest(encoder1.tokens, encoder1.encodedTrades),
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
      encoder2.encodeContractTrade(
        sampleOrder,
        verifier2.address,
        eip1271Signature,
      );
      // Transaction reverted: function returned an unexpected amount of data
      await expect(
        encoding.decodeTradesTest(encoder2.tokens, encoder2.encodedTrades),
      ).to.be.reverted;
    });

    it("should revert for EIP-1271 signatures from externally owned accounts", async () => {
      const encoder = new SettlementEncoder(testDomain);
      encoder.encodeContractTrade(sampleOrder, traders[0].address, "0x00");
      // Transaction reverted: function call to a non-contract account
      await expect(
        encoding.decodeTradesTest(encoder.tokens, encoder.encodedTrades),
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
      encoder.encodeContractTrade(
        sampleOrder,
        evilVerifier.address,
        eip1271Signature,
      );

      // Transaction reverted and Hardhat couldn't infer the reason.
      await expect(
        encoding.decodeTradesTest(encoder.tokens, encoder.encodedTrades),
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

      const encodedTrades = ethers.utils.arrayify(encoder.encodedTrades);

      encodedTrades[2 + 126] |= 0b11000000;
      await expect(
        encoding.decodeTradesTest(encoder.tokens, encodedTrades),
      ).to.be.revertedWith("GPv2: invalid signature scheme");
    });

    describe("invalid encoded trade", () => {
      const sampleTradeExecution = {
        executedAmount: fillUint(256, 0x09),
        feeDiscount: fillUint(16, 0x0a).toNumber(),
      };

      it("calldata shorter than single trade length", async () => {
        const encoder = new SettlementEncoder(testDomain);
        await encoder.signEncodeTrade(
          sampleOrder,
          traders[0],
          SigningScheme.EIP712,
          sampleTradeExecution,
        );

        const decoding = encoding.decodeTradesTest(
          encoder.tokens,
          encoder.encodedTrades.slice(0, -2),
        );
        await expect(decoding).to.be.revertedWith("signature too long");
      });

      it("calldata longer than single trade length", async () => {
        const encoder = new SettlementEncoder(testDomain);
        await encoder.signEncodeTrade(
          sampleOrder,
          traders[0],
          SigningScheme.EIP712,
          sampleTradeExecution,
        );

        const decoding = encoding.decodeTradesTest(
          encoder.tokens,
          encoder.encodedTrades + "00",
        );

        // Note: decoding reverts with "invalid opcode" since it tries to access
        // an array at an out-of-bound index.
        await expect(decoding).to.be.reverted;
      });
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

      const { mem } = await encoding.decodeTradesTest(
        encoder.tokens,
        encoder.encodedTrades,
      );
      expect(mem.toNumber()).to.equal(0);
    });
  });

  describe("decodeInteraction", () => {
    it("decodes sample encoded interactions", async () => {
      // Examples from the documentation describing `decodeInteraction` in the
      // [`GPv2Encoding`] library.
      for (const sample of [
        {
          encodedInteraction:
            "0x73c14081446bd1e4eb165250e826e80c5a52378300000010000102030405060708090a0b0c0d0e0f",
          target: ethers.utils.getAddress(
            "0x73c14081446bd1e4eb165250e826e80c5a523783",
          ),
          value: ethers.constants.Zero,
          callData: "0x000102030405060708090a0b0c0d0e0f",
        },
        {
          encodedInteraction:
            "0x0000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000de0b6b3a7640000",
          target: ethers.constants.AddressZero,
          value: ethers.utils.parseEther("1.0"),
          callData: "0x",
        },
      ]) {
        // Note: the number of interactions is a convenience input used to
        // preallocate the memory needed to store all interactions simultaneously.
        // If this number does not correspond exactly to the amount recovered
        // after decoding, then the test call reverts.
        const numInteractions = 1;
        const interactions = await encoding.decodeInteractionsTest(
          sample.encodedInteraction,
          numInteractions,
        );

        expect(interactions.length).to.equal(1);
        expect(interactions[0].target).to.equal(sample.target);
        expect(interactions[0].callData).to.equal(sample.callData);
        expect(interactions[0].value).to.deep.equal(sample.value);
      }
    });

    it("should round-trip encode a single interaction", async () => {
      // Note: all fields should use distinct bytes to make decoding errors
      // easier to spot. 0x11 is used to avoid having bytes with zeroes in their
      // hex representation.
      const interaction = {
        target: ethers.utils.getAddress(fillDistinctBytes(20, 0x11)),
        value: BigNumber.from(fillDistinctBytes(32, 0x11 + 20)),
        callData: fillDistinctBytes(42, 0x11 + 52),
      };

      const numInteractions = 1;
      const decodedInteractions = await encoding.decodeInteractionsTest(
        packInteractions([interaction]),
        numInteractions,
      );

      expect(decodedInteractions.length).to.equal(1);
      expect(decodedInteractions[0].target).to.equal(interaction.target);
      expect(decodedInteractions[0].callData).to.equal(interaction.callData);
    });

    it("should round-trip encode multiple interactions", async () => {
      // Note: all fields should use distinct bytes as much as possible to make
      // decoding errors easier to spot. 0x01 is used to avoid having bytes with
      // zeroes in their hex representation.
      let seed = 0x01;
      const nextBytes = (n: number) => fillDistinctBytes(n, (seed += n) - n);
      const nextAddress = () => ethers.utils.getAddress(nextBytes(20));
      const nextUint = () => BigNumber.from(nextBytes(32));
      const interactions = [
        {
          target: nextAddress(),
          value: nextUint(),
          callData: nextBytes(42),
        },
        {
          target: nextAddress(),
          value: nextUint(),
        },
        {
          target: nextAddress(),
          // Note: if the interaction decoding becomes significantly more
          // inefficient, this test might fail with "tx has a higher gas limit
          // than the block". In this case, the number of bytes below should be
          // reduced.
          callData: nextBytes(12000),
        },
        {
          target: nextAddress(),
        },
      ];

      const decodedInteractions = await encoding.decodeInteractionsTest(
        packInteractions(interactions),
        interactions.length,
      );

      expect(decodedInteractions.length).to.equal(interactions.length);
      for (let i = 0; i < interactions.length; i++) {
        const decodedInteraction = decodedInteractions[0];
        const interaction = interactions[0];

        expect(decodedInteraction.target).to.equal(interaction.target);
        expect(decodedInteraction.value).to.equal(
          interaction.value || ethers.constants.Zero,
        );
        expect(decodedInteraction.callData).to.equal(
          interaction.callData || "0x",
        );
      }
    });

    it("encoder fails to add interactions with too much calldata", async () => {
      const interaction = {
        target: ethers.utils.getAddress(fillBytes(20, 0x00)),
        callData: new Uint8Array(2 ** 24),
      };

      const encoder = new SettlementEncoder(testDomain);
      expect(() => encoder.encodeInteraction(interaction)).to.throw;
    });

    it("should round-trip encode an empty interaction", async () => {
      const interaction = {
        target: ethers.utils.getAddress(
          "0x73c14081446bd1e4eb165250e826e80c5a523783",
        ),
      };

      const numInteractions = 1;
      const decodedInteractions = await encoding.decodeInteractionsTest(
        packInteractions([interaction]),
        numInteractions,
      );

      expect(decodedInteractions.length).to.equal(1);
      expect(decodedInteractions[0].target).to.equal(interaction.target);
      expect(decodedInteractions[0].value).to.deep.equal(ethers.constants.Zero);
      expect(decodedInteractions[0].callData).to.equal("0x");
    });

    describe("invalid encoded interaction", () => {
      it("calldata shorter than length", async () => {
        const interaction = {
          target: ethers.utils.getAddress(fillBytes(20, 0x00)),
          value: ethers.utils.parseEther("42.1337"),
          callData: fillDistinctBytes(10, 0x00),
        };

        const numInteractions = 1;
        const decoding = encoding.decodeInteractionsTest(
          packInteractions([interaction]).slice(0, -2),
          numInteractions,
        );

        await expect(decoding).to.be.revertedWith("GPv2: invalid interaction");
      });

      it("calldata longer than length", async () => {
        const interaction = {
          target: ethers.utils.getAddress(fillBytes(20, 0x00)),
          value: ethers.utils.parseEther("42.1337"),
          callData: fillDistinctBytes(10, 0x00),
        };

        const numInteractions = 1;
        const decoding = encoding.decodeInteractionsTest(
          packInteractions([interaction]) + "00",
          numInteractions,
        );

        // Note: this call does not revert with "GPv2: invalid interaction", as
        // it would appear intuitive, but with "invalid opcode". This is because
        // of how `decodeInteractionsTest` works: since there is some calldata
        // left, it tries to parse it as another interaction. But the array used
        // to store the decoded interactions has size 1, so the function is
        // accessing an out-of-bound element.
        await expect(decoding).to.be.reverted;
      });
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

  describe("decodeOrderUidsTest", () => {
    it("should round trip encode/decode", async () => {
      // Start from 17 (0x11) so that the first byte has no zeroes.
      const orderUids = [
        fillDistinctBytes(56, 17),
        fillDistinctBytes(56, 17 + 56),
        fillDistinctBytes(56, 17 + 56 * 2),
      ];

      const decodedOrderUids = await encoding.decodeOrderUidsTest(
        ethers.utils.solidityPack(
          orderUids.map(() => "bytes"),
          orderUids,
        ),
      );
      expect(decodedOrderUids).to.deep.equal(orderUids);
    });

    it("should accept empty order UIDs", async () => {
      expect(await encoding.decodeOrderUidsTest("0x")).to.deep.equal([]);
    });

    it("should revert on malformed order UIDs", async () => {
      const invalidUids = "0x00";
      await expect(
        encoding.decodeOrderUidsTest(invalidUids),
      ).to.be.revertedWith("malformed order UIDs");
    });
  });
});
