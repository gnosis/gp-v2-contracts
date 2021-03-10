// defined in https://eips.ethereum.org/EIPS/eip-1967

import { BigNumber, Contract, ethers } from "ethers";

// The proxy contract used by hardhat-deploy implements EIP-1967 (Standard Proxy
// Storage Slot). See <https://eips.ethereum.org/EIPS/eip-1967>.
function slot(string: string) {
  return ethers.utils.defaultAbiCoder.encode(
    ["bytes32"],
    [BigNumber.from(ethers.utils.id(string)).sub(1)],
  );
}
const IMPLEMENTATION_STORAGE_SLOT = slot("eip1967.proxy.implementation");
const OWNER_STORAGE_SLOT = slot("eip1967.proxy.admin");

/**
 * Returns the address of the implementation of an EIP-1967-compatible proxy
 * from its address.
 *
 * @param proxy Address of the proxy contract.
 * @returns The address of the contract storing the proxy implementation.
 */
export async function implementationAddress(
  provider: ethers.providers.Provider,
  proxy: string,
): Promise<string> {
  const [implementation] = ethers.utils.defaultAbiCoder.decode(
    ["address"],
    await provider.getStorageAt(proxy, IMPLEMENTATION_STORAGE_SLOT),
  );
  return implementation;
}

/**
 * Returns the address of the implementation of an EIP-1967-compatible proxy
 * from its address.
 *
 * @param proxy Address of the proxy contract.
 * @returns The address of the administrator of the proxy.
 */
export async function ownerAddress(
  provider: ethers.providers.Provider,
  proxy: string,
): Promise<string> {
  const [owner] = ethers.utils.defaultAbiCoder.decode(
    ["address"],
    await provider.getStorageAt(proxy, OWNER_STORAGE_SLOT),
  );
  return owner;
}

/**
 * EIP-173 proxy ABI in "Human-readable ABI format".
 *
 * <https://eips.ethereum.org/EIPS/eip-173#specification>
 */
export const EIP173_PROXY_ABI = [
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "function owner() view external returns(address)",
  "function transferOwnership(address newOwner) external",
  "function supportsInterface(bytes4 interfaceID) external view returns (bool)",
];

/**
 * Returns the proxy interface for the specified address.
 *
 * @param contract The proxy contract to return a proxy interface for.
 * @returns A Ethers.js contract instance for interacting with the proxy.
 */
export function proxyInterface(contract: Contract): Contract {
  return new Contract(
    contract.address,
    EIP173_PROXY_ABI,
    contract.signer ?? contract.provider,
  );
}
