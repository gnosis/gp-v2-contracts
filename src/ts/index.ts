import { TypedDataDomain } from "ethers";

/**
 * Return the Gnosis Protocol v2 domain used for signing.
 * @param chainId The EIP-155 chain ID.
 * @param verifyingContract The address of the contract that will verify the
 * signature.
 * @return An EIP-712 compatible typed domain data.
 */
export function domain(
  chainId: number,
  verifyingContract: string,
): TypedDataDomain {
  return {
    name: "Gnosis Protocol",
    version: "v2",
    chainId,
    verifyingContract,
  };
}

export * from "./order";
export * from "./interaction";
export * from "./settlement";
export * from "./reader";
export * from "./deploy";
