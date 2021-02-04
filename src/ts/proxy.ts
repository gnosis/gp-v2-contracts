// defined in https://eips.ethereum.org/EIPS/eip-1967

import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";
import Proxy from "hardhat-deploy/extendedArtifacts/EIP173Proxy.json";

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
export async function implementationAddress(proxy: string): Promise<string> {
  const [implementation] = ethers.utils.defaultAbiCoder.decode(
    ["address"],
    await ethers.provider.getStorageAt(proxy, IMPLEMENTATION_STORAGE_SLOT),
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
export async function ownerAddress(proxy: string): Promise<string> {
  const [owner] = ethers.utils.defaultAbiCoder.decode(
    ["address"],
    await ethers.provider.getStorageAt(proxy, OWNER_STORAGE_SLOT),
  );
  return owner;
}

/**
 * Returns the proxy interface for the specified address.
 *
 * @param contract The proxy contract to return a proxy interface for.
 * @returns A Ethers.js contract instance for interacting with the proxy.
 */
export function proxyInterface(contract: Contract): Contract {
  const { abi } = Proxy;
  return new Contract(
    contract.address,
    abi,
    contract.signer ?? contract.provider,
  );
}
