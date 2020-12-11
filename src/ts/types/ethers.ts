import type { ethers, Signer } from "ethers";

/**
 * A signature-like type.
 */
export type SignatureLike = Parameters<typeof ethers.utils.splitSignature>[0];

/**
 * EIP-712 typed data domain.
 */
export type TypedDataDomain = Parameters<
  typeof ethers.utils._TypedDataEncoder.hashDomain
>[0];

export interface TypedDataSigner extends Signer {
  /**
   * Signs the typed data value with types data structure for domain using the
   * EIP-712 specification.
   */
  _signTypedData: typeof ethers.VoidSigner.prototype._signTypedData;
}

export function isTypedDataSigner(signer: Signer): signer is TypedDataSigner {
  return "_signTypedData" in signer;
}
