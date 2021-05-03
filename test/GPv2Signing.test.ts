import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import {
  EIP1271_MAGICVALUE,
  OrderBalance,
  OrderKind,
  PRE_SIGNED,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  computeOrderUid,
  domain,
  encodeEip1271SignatureData,
  hashOrder,
  packOrderUidParams,
  signOrder,
} from "../src/ts";

import { decodeOrder, encodeOrder } from "./encoding";
import { fillBytes, fillUint, SAMPLE_ORDER } from "./testHelpers";

describe("GPv2Signing", () => {
  const [deployer, ...traders] = waffle.provider.getWallets();

  let signing: Contract;
  let testDomain: TypedDataDomain;

  beforeEach(async () => {
    const GPv2Signing = await ethers.getContractFactory(
      "GPv2SigningTestInterface",
    );

    signing = await GPv2Signing.deploy();

    const { chainId } = await ethers.provider.getNetwork();
    testDomain = domain(chainId, signing.address);
  });

  describe("domainSeparator", () => {
    it("should have an EIP-712 domain separator", async () => {
      expect(await signing.domainSeparator()).to.equal(
        ethers.utils._TypedDataEncoder.hashDomain(testDomain),
      );
    });

    it("should have a different replay protection for each deployment", async () => {
      const GPv2Signing = await ethers.getContractFactory(
        "GPv2SigningTestInterface",
      );
      const signing2 = await GPv2Signing.deploy();

      expect(await signing.domainSeparator()).to.not.equal(
        await signing2.domainSeparator(),
      );
    });
  });

  describe("setPreSignature", () => {
    const [owner, nonOwner] = traders;
    const orderUid = packOrderUidParams({
      orderDigest: ethers.constants.HashZero,
      owner: owner.address,
      validTo: 0xffffffff,
    });

    it("should set the pre-signature", async () => {
      await signing.connect(owner).setPreSignature(orderUid, true);
      expect(await signing.preSignature(orderUid)).to.equal(PRE_SIGNED);
    });

    it("should unset the pre-signature", async () => {
      await signing.connect(owner).setPreSignature(orderUid, true);
      await signing.connect(owner).setPreSignature(orderUid, false);
      expect(await signing.preSignature(orderUid)).to.equal(
        ethers.constants.Zero,
      );
    });

    it("should emit a PreSignature event", async () => {
      await expect(signing.connect(owner).setPreSignature(orderUid, true))
        .to.emit(signing, "PreSignature")
        .withArgs(owner.address, orderUid, true);

      await expect(signing.connect(owner).setPreSignature(orderUid, false))
        .to.emit(signing, "PreSignature")
        .withArgs(owner.address, orderUid, false);
    });

    it("should emit a PreSignature event even if storage doesn't change", async () => {
      await signing.connect(owner).setPreSignature(orderUid, true);
      await expect(signing.connect(owner).setPreSignature(orderUid, true))
        .to.emit(signing, "PreSignature")
        .withArgs(owner.address, orderUid, true);
    });

    it("should revert if the order owner is not the transaction sender", async () => {
      await expect(
        signing.connect(nonOwner).setPreSignature(orderUid, true),
      ).to.be.revertedWith("cannot presign order");
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

      const { data: encodedOrder } = await signing.recoverOrderFromTradeTest(
        encoder.tokens,
        encoder.trades[0],
      );
      expect(decodeOrder(encodedOrder)).to.deep.equal(order);
    });

    it("should compute order unique identifier", async () => {
      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        SAMPLE_ORDER,
        traders[0],
        SigningScheme.EIP712,
      );

      const { uid: orderUid } = await signing.recoverOrderFromTradeTest(
        encoder.tokens,
        encoder.trades[0],
      );
      expect(orderUid).to.equal(
        computeOrderUid(testDomain, SAMPLE_ORDER, traders[0].address),
      );
    });

    it("should recover the owner for all signing schemes", async () => {
      const artifact = await artifacts.readArtifact("EIP1271Verifier");
      const verifier = await waffle.deployMockContract(deployer, artifact.abi);
      await verifier.mock.isValidSignature.returns(EIP1271_MAGICVALUE);

      const sampleOrderUid = computeOrderUid(
        testDomain,
        SAMPLE_ORDER,
        traders[2].address,
      );
      await signing.connect(traders[2]).setPreSignature(sampleOrderUid, true);

      const encoder = new SettlementEncoder(testDomain);
      await encoder.signEncodeTrade(
        SAMPLE_ORDER,
        traders[0],
        SigningScheme.EIP712,
      );
      await encoder.signEncodeTrade(
        SAMPLE_ORDER,
        traders[1],
        SigningScheme.ETHSIGN,
      );
      encoder.encodeTrade(SAMPLE_ORDER, {
        scheme: SigningScheme.EIP1271,
        data: {
          verifier: verifier.address,
          signature: "0x",
        },
      });
      encoder.encodeTrade(SAMPLE_ORDER, {
        scheme: SigningScheme.PRESIGN,
        data: traders[2].address,
      });

      const owners = [
        traders[0].address,
        traders[1].address,
        verifier.address,
        traders[2].address,
      ];

      for (const [i, trade] of encoder.trades.entries()) {
        const { owner } = await signing.recoverOrderFromTradeTest(
          encoder.tokens,
          trade,
        );
        expect(owner).to.equal(owners[i]);
      }
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
          SAMPLE_ORDER,
          traders[0],
          SigningScheme.EIP712,
        );

        const { uid: orderUid } = await signing.recoverOrderFromTradeTest(
          encoder.tokens,
          encoder.trades[0],
        );

        const encodedTransactionData = ethers.utils.arrayify(
          signing.interface.encodeFunctionData("recoverOrderFromTradeTest", [
            encoder.tokens,
            encoder.trades[0],
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

  describe("recoverOrderSigner", () => {
    it("should recover signing address for all supported ECDSA-based schemes", async () => {
      for (const scheme of [
        SigningScheme.EIP712,
        SigningScheme.ETHSIGN,
      ] as const) {
        const { data: signature } = await signOrder(
          testDomain,
          SAMPLE_ORDER,
          traders[0],
          scheme,
        );
        expect(
          await signing.recoverOrderSignerTest(
            encodeOrder(SAMPLE_ORDER),
            scheme,
            signature,
          ),
        ).to.equal(traders[0].address);
      }
    });

    it("should revert for invalid signing schemes", async () => {
      await expect(
        signing.recoverOrderSignerTest(encodeOrder(SAMPLE_ORDER), 42, "0x"),
      ).to.be.reverted;
    });

    it("should revert for malformed ECDSA signatures", async () => {
      for (const scheme of [SigningScheme.EIP712, SigningScheme.ETHSIGN]) {
        await expect(
          signing.recoverOrderSignerTest(
            encodeOrder(SAMPLE_ORDER),
            scheme,
            "0x",
          ),
        ).to.be.revertedWith("malformed ecdsa signature");
      }
    });

    it("should revert for invalid eip-712 order signatures", async () => {
      const { data: signature } = await signOrder(
        testDomain,
        SAMPLE_ORDER,
        traders[0],
        SigningScheme.EIP712,
      );

      // NOTE: `v` must be either `27` or `28`, so just set it to something else
      // to generate an invalid signature.
      const invalidSignature = ethers.utils.arrayify(
        ethers.utils.joinSignature(signature),
      );
      invalidSignature[64] = 42;

      await expect(
        signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.EIP712,
          invalidSignature,
        ),
      ).to.be.revertedWith("invalid ecdsa signature");
    });

    it("should revert for invalid ethsign order signatures", async () => {
      const { data: signature } = await signOrder(
        testDomain,
        SAMPLE_ORDER,
        traders[0],
        SigningScheme.ETHSIGN,
      );

      // NOTE: `v` must be either `27` or `28`, so just set it to something else
      // to generate an invalid signature.
      const invalidSignature = ethers.utils.arrayify(
        ethers.utils.joinSignature(signature),
      );
      invalidSignature[64] = 42;

      await expect(
        signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.ETHSIGN,
          invalidSignature,
        ),
      ).to.be.revertedWith("invalid ecdsa signature");
    });

    it("should verify EIP-1271 contract signatures by returning owner", async () => {
      const artifact = await artifacts.readArtifact("EIP1271Verifier");
      const verifier = await waffle.deployMockContract(deployer, artifact.abi);

      const message = hashOrder(testDomain, SAMPLE_ORDER);
      const eip1271Signature = "0x031337";
      await verifier.mock.isValidSignature
        .withArgs(message, eip1271Signature)
        .returns(EIP1271_MAGICVALUE);

      expect(
        await signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.EIP1271,
          encodeEip1271SignatureData({
            verifier: verifier.address,
            signature: eip1271Signature,
          }),
        ),
      ).to.equal(verifier.address);
    });

    it("should revert on an invalid EIP-1271 signature", async () => {
      const message = hashOrder(testDomain, SAMPLE_ORDER);
      const eip1271Signature = "0x031337";

      const artifact = await artifacts.readArtifact("EIP1271Verifier");
      const verifier1 = await waffle.deployMockContract(deployer, artifact.abi);

      await verifier1.mock.isValidSignature
        .withArgs(message, eip1271Signature)
        .returns("0xbaadc0d3");
      await expect(
        signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.EIP1271,
          encodeEip1271SignatureData({
            verifier: verifier1.address,
            signature: eip1271Signature,
          }),
        ),
      ).to.be.revertedWith("invalid eip1271 signature");
    });

    it("should revert with non-standard EIP-1271 verifiers", async () => {
      const message = hashOrder(testDomain, SAMPLE_ORDER);
      const eip1271Signature = "0x031337";

      const NON_STANDARD_EIP1271_VERIFIER = [
        "function isValidSignature(bytes32 _hash, bytes memory _signature)",
      ]; // no return value
      const verifier = await waffle.deployMockContract(
        deployer,
        NON_STANDARD_EIP1271_VERIFIER,
      );

      await verifier.mock.isValidSignature
        .withArgs(message, eip1271Signature)
        .returns();
      await expect(
        signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.EIP1271,
          encodeEip1271SignatureData({
            verifier: verifier.address,
            signature: eip1271Signature,
          }),
        ),
      ).to.be.reverted;
    });

    it("should revert for EIP-1271 signatures from externally owned accounts", async () => {
      // Transaction reverted: function call to a non-contract account
      await expect(
        signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.EIP1271,
          encodeEip1271SignatureData({
            verifier: traders[0].address,
            signature: "0x00",
          }),
        ),
      ).to.be.reverted;
    });

    it("should revert if the EIP-1271 verification function changes the state", async () => {
      const StateChangingEIP1271 = await ethers.getContractFactory(
        "StateChangingEIP1271",
      );

      const evilVerifier = await StateChangingEIP1271.deploy();
      const message = hashOrder(testDomain, SAMPLE_ORDER);
      const eip1271Signature = "0x";

      expect(await evilVerifier.state()).to.equal(ethers.constants.Zero);
      await evilVerifier.isValidSignature(message, eip1271Signature);
      expect(await evilVerifier.state()).to.equal(ethers.constants.One);
      expect(
        await evilVerifier.callStatic.isValidSignature(
          message,
          eip1271Signature,
        ),
      ).to.equal(EIP1271_MAGICVALUE);

      // Transaction reverted and Hardhat couldn't infer the reason.
      await expect(
        signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.EIP1271,
          encodeEip1271SignatureData({
            verifier: evilVerifier.address,
            signature: eip1271Signature,
          }),
        ),
      ).to.be.reverted;
      expect(await evilVerifier.state()).to.equal(ethers.constants.One);
    });

    it("should verify pre-signed order", async () => {
      const orderUid = computeOrderUid(
        testDomain,
        SAMPLE_ORDER,
        traders[0].address,
      );

      await signing.connect(traders[0]).setPreSignature(orderUid, true);
      expect(
        await signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.PRESIGN,
          traders[0].address,
        ),
      ).to.equal(traders[0].address);
    });

    it("should revert if order doesn't have pre-signature set", async () => {
      await expect(
        signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.PRESIGN,
          traders[0].address,
        ),
      ).to.be.revertedWith("order not presigned");
    });

    it("should revert if pre-signed order is modified", async () => {
      await signing
        .connect(traders[0])
        .setPreSignature(
          computeOrderUid(testDomain, SAMPLE_ORDER, traders[0].address),
          true,
        );

      await expect(
        signing.recoverOrderSignerTest(
          encodeOrder({
            ...SAMPLE_ORDER,
            buyAmount: ethers.constants.Zero,
          }),
          SigningScheme.PRESIGN,
          traders[0].address,
        ),
      ).to.be.revertedWith("order not presigned");
    });

    it("should revert for malformed pre-sign order UID", async () => {
      await expect(
        signing.recoverOrderSignerTest(
          encodeOrder(SAMPLE_ORDER),
          SigningScheme.PRESIGN,
          "0x",
        ),
      ).to.be.revertedWith("malformed presignature");
    });
  });
});
