import type { DeploymentExecutor } from "@openzeppelin/hardhat-upgrades/dist/utils/deploy";
import { ContractFactory, ContractTransaction, BigNumber } from "ethers";
import { ethers, upgrades } from "hardhat";
import { DeployFunction, DeployOptions } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { CONTRACT_NAMES, SALT } from "../ts/deploy";

const deployAuthenticator: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  getChainId,
}: HardhatRuntimeEnvironment) {
  const { deployer, owner } = await getNamedAccounts();
  const { deploy } = deployments;

  const { authenticator } = CONTRACT_NAMES;

  const AuthenticatorFactory = await ethers.getContractFactory(authenticator);
  const authenticatorDeployer: DeploymentExecutor = async (
    factory: ContractFactory,
  ) => {
    console.log(factory);
    const options: DeployOptions = {
      from: deployer,
      gasLimit: 2000000,
      // args: [owner],
      deterministicDeployment: SALT,
      log: true,
    };
    const { address, transactionHash } = await deploy(authenticator, options);
    if (transactionHash === undefined) {
      throw new Error("Authenticor deployment failed");
    } else {
      const receipt = ethers.provider.getTransactionReceipt(transactionHash);
      const deployerNonce = await ethers.provider.getTransactionCount(deployer);
      const deployTransaction: ContractTransaction = {
        ...receipt,
        from: deployer,
        nonce: deployerNonce,
        hash: transactionHash,
        chainId: parseInt(await getChainId()),
        gasLimit: BigNumber.from("2000000"),
        gasPrice: BigNumber.from(0),
        value: BigNumber.from(0),
        data: "0",
        confirmations: 1,
        wait: () => receipt,
      };
      return {
        address,
        deployTransaction,
      };
    }
  };
  await upgrades.deployProxy(AuthenticatorFactory, [owner], {
    initializer: "initialize",
    unsafeAllowCustomTypes: true,
    unsafeAllowLinkedLibraries: true,
    executor: authenticatorDeployer,
  });
};

export default deployAuthenticator;
