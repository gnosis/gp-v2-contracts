import { utils } from "ethers";
import { ethers } from "hardhat";

/**
 * Dictionary containing deployed contract names.
 */
export const contractNames = {
  authenticator: "GPv2AllowListAuthentication",
  settlement: "GPv2Settlement",
};

/**
 * The salt used when deterministically deploying smart contracts.
 */
export const SALT = utils.formatBytes32String("dev");

/**
 * The contract used to deploy contracts deterministically with CREATE2.
 * The address is chosen by the hardhat-deploy library.
 * It is the same in any EVM-based network.
 *
 * https://github.com/Arachnid/deterministic-deployment-proxy
 */
const DEPLOYER_CONTRACT = "0x4e59b44847b379578588920ca78fbf26c0b4956c";

/**
 * Computes the deterministic address at which the contract will be deployed.
 * This address does not depend on which network the contract is deployed to.
 *
 * @param contractName Name of the contract for which to find the address.
 * @param deploymentArguments Extra arguments that are necessary to deploy.
 * @returns The address that is expected to store the deployed code.
 */
export async function deterministicDeploymentAddress(
  contractName: string,
  ...deploymentArguments: unknown[]
): Promise<string> {
  const factory = await ethers.getContractFactory(contractName);
  const deployTransaction = factory.getDeployTransaction(
    ...deploymentArguments,
  );

  return utils.getCreate2Address(
    DEPLOYER_CONTRACT,
    SALT,
    utils.keccak256(deployTransaction.data || "0x"),
  );
}
