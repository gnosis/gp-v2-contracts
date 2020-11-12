/**
 * Additional typings extensions for Ethers.js.
 */

import { ethers } from "ethers";

declare module "ethers" {
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

  interface Signer {
    /**
     * Signs the typed data value with types data structure for domain using the
     * EIP-712 specification.
     */
    _signTypedData?: (
      domain: TypedDataDomain,
      types: Record<string, Array<TypedDataField>>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: Record<string, any>,
    ) => Promise<string>;
  }
}
