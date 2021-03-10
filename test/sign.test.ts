import { expect } from "chai";
import { ethers, waffle } from "hardhat";

import {
  SigningScheme,
  signOrderCancellation,
  hashOrderCancellation,
  // TypedDataDomain,
  // OrderCancellation,
} from "../src/ts";

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
  it.only("should recover signing address for EIP712 scheme", async () => {
    const [signer] = waffle.provider.getWallets();
    const domain = { name: "test" };
    const sampleOrderCancellation = {
      orderUid: `0x${"2a".repeat(56)}`,
    };
    for (const scheme of [
      SigningScheme.EIP712,
      SigningScheme.ETHSIGN,
    ] as const) {
      const { data: signature } = await signOrderCancellation(
        domain,
        sampleOrderCancellation,
        signer,
        scheme,
      );

      const signingHash = recoverSigningDigest(
        scheme,
        hashOrderCancellation(domain, sampleOrderCancellation),
      );
      expect(ethers.utils.recoverAddress(signingHash, signature)).to.equal(
        signer.address,
      );
    }
  });
});
