import { joinSignature } from "@ethersproject/bytes";
import { hashMessage } from "@ethersproject/hash";
import type { JsonRpcProvider } from "@ethersproject/providers";
import { SigningKey } from "@ethersproject/signing-key";
import { expect } from "chai";
import { ethers, waffle } from "hardhat";

import {
  SigningScheme,
  signOrderCancellation,
  hashOrderCancellation,
  signOrder,
} from "../src/ts";

import { SAMPLE_ORDER } from "./testHelpers";

const patchedSignMessageBuilder = (key: SigningKey) => async (
  message: string,
): Promise<string> => {
  // Reproducing `@ethersproject/wallet/src.ts/index.ts` sign message bahaviour
  const sig = joinSignature(key.signDigest(hashMessage(message)));

  // Unpack the signature
  const { r, s, v } = ethers.utils.splitSignature(sig);
  // Pack it again
  return ethers.utils.solidityPack(
    ["bytes32", "bytes32", "uint8"],
    // Remove last byte's `27` padding
    [r, s, v - 27],
  );
};

type SpyProvider = JsonRpcProvider & {
  called: number;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[];
};

// Custom made spy for the provider
// Patches the `send` method to track calls and params
// Returns a fake signature
const patchProvider = (p: SpyProvider) => {
  p.called = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p.send = async (method: string, params: any[]): Promise<string> => {
    p.method = method;
    p.params = params;
    p.called += 1;

    // Fake signature, don't care about it.
    // Besides, the Signer provided by hardhat doesn't support `eth_signTypedMessage_v3` and will throw
    return "0x80bc78815e333b8c62c6f493dacecd47b283ca04d0cf18394e22a050a2ff356a65ea766c393671682a053be36c395a5d45d8524235132ba660563178a2e15c7e1c";
  };

  return p;
};

describe("signOrder", () => {
  it("should pad the `v` byte when needed", async () => {
    const [signer] = waffle.provider.getWallets();
    // Patch signMessage
    signer.signMessage = patchedSignMessageBuilder(signer._signingKey());

    const domain = { name: "test" };

    for (const scheme of [
      SigningScheme.EIP712,
      SigningScheme.ETHSIGN,
    ] as const) {
      // Extract `v` from the signature data
      const v = ethers.utils.hexDataSlice(
        (await signOrder(domain, SAMPLE_ORDER, signer, scheme)).data as string,
        64,
        65,
      );
      // Confirm it is either 27 or 28, in hex
      expect(v).to.be.oneOf(["0x1b", "0x1c"]);
    }
  });

  it("should call eth_signTypedData_v3", async () => {
    const [signer] = waffle.provider.getWallets();
    // Patch the provider's `send` method
    Object.defineProperty(
      signer,
      "provider",
      patchProvider(signer.provider as SpyProvider),
    );

    const domain = { name: "test" };

    await signOrder(domain, SAMPLE_ORDER, signer, SigningScheme.EIP712, {
      signTypedDataVersion: "v3",
    });

    expect((signer.provider as SpyProvider).called).to.be.equal(1);
    expect((signer.provider as SpyProvider).method).to.be.equal(
      "eth_signTypedData_v3",
    );
  });

  it("should not call eth_signTypedData_v3", async () => {
    const [signer] = waffle.provider.getWallets();
    // Patch the provider's `send` method
    Object.defineProperty(
      signer,
      "provider",
      patchProvider(signer.provider as SpyProvider),
    );

    const domain = { name: "test" };

    for (const [scheme, options] of [
      [SigningScheme.EIP712, undefined],
      [SigningScheme.EIP712, { signTypedDataVersion: "v4" }],
      [SigningScheme.ETHSIGN, undefined],
    ] as const) {
      await signOrder(domain, SAMPLE_ORDER, signer, scheme, options);

      // Non `v3` won't use the patched provider
      expect((signer.provider as SpyProvider).called).to.be.equal(0);
    }
  });
});

function recoverSigningDigest(
  scheme: SigningScheme,
  cancellationHash: string,
): string {
  switch (scheme) {
    case SigningScheme.EIP712:
      return cancellationHash;
    case SigningScheme.ETHSIGN:
      return ethers.utils.hashMessage(ethers.utils.arrayify(cancellationHash));
    default:
      throw new Error("unsupported signing scheme");
  }
}

describe("signOrderCancellation", () => {
  it("should recover signing address for all supported signing schemes", async () => {
    const [signer] = waffle.provider.getWallets();
    const domain = { name: "test" };
    const orderUid = `0x${"2a".repeat(56)}`;

    for (const scheme of [
      SigningScheme.EIP712,
      SigningScheme.ETHSIGN,
    ] as const) {
      const { data: signature } = await signOrderCancellation(
        domain,
        orderUid,
        signer,
        scheme,
      );

      const signingHash = recoverSigningDigest(
        scheme,
        hashOrderCancellation(domain, orderUid),
      );
      expect(ethers.utils.recoverAddress(signingHash, signature)).to.equal(
        signer.address,
      );
    }
  });

  it("should pad the `v` byte when needed", async () => {
    const [signer] = waffle.provider.getWallets();
    // Patch signMessage
    signer.signMessage = patchedSignMessageBuilder(signer._signingKey());

    const domain = { name: "test" };
    const orderUid = `0x${"2a".repeat(56)}`;

    for (const scheme of [
      SigningScheme.EIP712,
      SigningScheme.ETHSIGN,
    ] as const) {
      // Extract `v` from the signature data
      const v = ethers.utils.hexDataSlice(
        (await signOrderCancellation(domain, orderUid, signer, scheme))
          .data as string,
        64,
        65,
      );
      // Confirm it is either 27 or 28, in hex
      expect(v).to.be.oneOf(["0x1b", "0x1c"]);
    }
  });

  it("should call eth_signTypedData_v3", async () => {
    const [signer] = waffle.provider.getWallets();
    // Patch the provider's `send` method
    Object.defineProperty(
      signer,
      "provider",
      patchProvider(signer.provider as SpyProvider),
    );

    const domain = { name: "test" };
    const orderUid = `0x${"2a".repeat(56)}`;

    await signOrderCancellation(
      domain,
      orderUid,
      signer,
      SigningScheme.EIP712,
      {
        signTypedDataVersion: "v3",
      },
    );

    expect((signer.provider as SpyProvider).called).to.be.equal(1);
    expect((signer.provider as SpyProvider).method).to.be.equal(
      "eth_signTypedData_v3",
    );
  });

  it("should not call eth_signTypedData_v3", async () => {
    const [signer] = waffle.provider.getWallets();
    // Patch the provider's `send` method
    Object.defineProperty(
      signer,
      "provider",
      patchProvider(signer.provider as SpyProvider),
    );

    const domain = { name: "test" };
    const orderUid = `0x${"2a".repeat(56)}`;

    for (const [scheme, options] of [
      [SigningScheme.EIP712, undefined],
      [SigningScheme.EIP712, { signTypedDataVersion: "v4" }],
      [SigningScheme.ETHSIGN, undefined],
    ] as const) {
      await signOrderCancellation(domain, orderUid, signer, scheme, options);

      // Non `v3` won't use the patched provider
      expect((signer.provider as SpyProvider).called).to.be.equal(0);
    }
  });
});
