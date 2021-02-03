// defined in https://eips.ethereum.org/EIPS/eip-1967

import { BigNumber } from "ethers";
import { ethers } from "hardhat";

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
  const [implementation] = await ethers.utils.defaultAbiCoder.decode(
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
  const [owner] = await ethers.utils.defaultAbiCoder.decode(
    ["address"],
    await ethers.provider.getStorageAt(proxy, OWNER_STORAGE_SLOT),
  );
  return owner;
}
