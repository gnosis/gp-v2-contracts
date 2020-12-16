// This file relies on the presence of build artifacts and should not be
// imported, directly or indirectly, in the Hardhat configs.

import { utils } from "ethers";
import { Artifact } from "hardhat/types";

import authenticatorArtifacts from "../../build/artifacts/src/contracts/GPv2AllowListAuthentication.sol/GPv2AllowListAuthentication.json";
import settlementArtifacts from "../../build/artifacts/src/contracts/GPv2Settlement.sol/GPv2Settlement.json";

import {
  ContractName,
  CONTRACT_NAMES,
  DEPLOYER_CONTRACT,
  DeploymentArguments,
  SALT,
} from "./deploy";

/**
 * Computes the deterministic address at which the contract will be deployed.
 * This address does not depend on which network the contract is deployed to.
 *
 * @param contractName Name of the contract for which to find the address.
 * @param deploymentArguments Extra arguments that are necessary to deploy.
 * @returns The address that is expected to store the deployed code.
 */
export function deterministicDeploymentAddress<C extends ContractName>(
  contractName: C,
  ...deploymentArguments: DeploymentArguments<C>
): string {
  // NOTE: Use dynamic import to load the contract artifact instead of
  // `getContract` so that we don't need to depend on `hardhat` when using this
  // project as a dependency.
  const { abi, bytecode } = getArtifacts(contractName);

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

function getArtifacts(contractName: ContractName): Artifact {
  switch (contractName) {
    case CONTRACT_NAMES.settlement:
      return settlementArtifacts;
    case CONTRACT_NAMES.authenticator:
      return authenticatorArtifacts;
  }
}
