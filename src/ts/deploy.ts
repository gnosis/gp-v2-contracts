import { utils } from "ethers";

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
 * Dictionary containing all deployed contract names.
 */
export const CONTRACT_NAMES = {
  authenticator: "GPv2AllowListAuthentication",
  settlement: "GPv2Settlement",
} as const;

/**
 * The name of a deployed contract.
 */
export type ContractName = typeof CONTRACT_NAMES[keyof typeof CONTRACT_NAMES];

/**
 * The deployment args for a contract.
 */
export type DeploymentArguments<
  T extends ContractName
> = T extends typeof CONTRACT_NAMES.authenticator
  ? [string]
  : T extends typeof CONTRACT_NAMES.settlement
  ? [string]
  : never;

/**
 * Computes the deterministic address at which the contract will be deployed.
 * This address does not depend on which network the contract is deployed to.
 *
 * @param contractName Name of the contract for which to find the address.
 * @param deploymentArguments Extra arguments that are necessary to deploy.
 * @returns The address that is expected to store the deployed code.
 */
export async function deterministicDeploymentAddress<C extends ContractName>(
  contractName: C,
  ...deploymentArguments: DeploymentArguments<C>
): Promise<string> {
  // NOTE: Use dynamic import to load the contract artifact instead of
  // `getContract` so that we don't need to depend on `hardhat` when using this
  // project as a dependency.
  const { abi, bytecode } = await import(getArtifactPath(contractName));

  const contractInterface = new utils.Interface(abi);
  const deployData = utils.hexConcat([
    bytecode,
    contractInterface.encodeDeploy(deploymentArguments),
  ]);

  return utils.getCreate2Address(
    DEPLOYER_CONTRACT,
    SALT,
    utils.keccak256(deployData),
  );
}

function getArtifactPath(contractName: ContractName): string {
  const artifactsRoot = "../../build/artifacts/";
  return `${artifactsRoot}/src/contracts/${contractName}.sol/${contractName}.json`;
}
