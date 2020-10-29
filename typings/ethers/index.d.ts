/**
 * Additional typings for Ethers.js
 */

import { ethers } from "ethers";

declare module "ethers" {
  /**
   * A signature-like type.
   *
   * Note this type definition is included here as it is not re-exported by the
   * main `ethers` package.
   */
  export type SignatureLike = Parameters<typeof ethers.utils.splitSignature>[0];
}
