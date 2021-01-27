// import type { TxExecutor } from "@openzeppelin/hardhat-upgrades/dist/utils/deploy";
// import { ContractFactory } from "ethers";
// import { ethers, upgrades } from "hardhat";
// import { DeployFunction, DeployOptions } from "hardhat-deploy/types";
// import { HardhatRuntimeEnvironment } from "hardhat/types";

// import { CONTRACT_NAMES, SALT } from "../ts/deploy";

// const deployAuthenticator: DeployFunction = async function ({
//   deployments,
//   getNamedAccounts,
// }: HardhatRuntimeEnvironment) {
//   const { owner } = await getNamedAccounts();
//   const { deploy } = deployments;
//   const { authenticator } = CONTRACT_NAMES;

//   const AuthenticatorFactory = await ethers.getContractFactory(authenticator);

//   const deploymentExecutor: TxExecutor = async (_factory: ContractFactory) => {
//     // Factory is not actually neededhere... its just part of the TxExecutor spec.
//     const options: DeployOptions = {
//       from: owner,
//       gasLimit: "2000000",
//       deterministicDeployment: SALT,
//       log: true,
//     };
//     const { address, transactionHash } = await deploy(authenticator, options);
//     return {
//       address,
//       transactionHash,
//     };
//   };

//   await upgrades.deployProxy(AuthenticatorFactory, {
//     initializer: "initialize",
//     executor: deploymentExecutor,
//   });
// };

// export default deployAuthenticator;

import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { CONTRACT_NAMES, SALT } from "../ts/deploy";

const deployAuthenticator: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) {
  const { deployer, owner } = await getNamedAccounts();
  const { deploy } = deployments;

  const { authenticator } = CONTRACT_NAMES;
  // TODO - use intended owner here somehow, maybe with transferOwnership call at deploy time.
  await deploy(authenticator, {
    from: deployer,
    gasLimit: 2000000,
    deterministicDeployment: SALT,
    log: true,
    proxy: true,
  });
};

export default deployAuthenticator;
