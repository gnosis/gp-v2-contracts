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
    // TODO - this console log is just to get rid of the unused variable warning.
    console.log(factory);

    const options: DeployOptions = {
      from: deployer,
      gasLimit: BigNumber.from("2000000"),
      gasPrice: BigNumber.from("21000000000"),
      value: BigNumber.from(0),
      data: "0",
      deterministicDeployment: SALT,
      log: true,
    };
    // TODO - hardcoded authenticator deployment is bad news!
    const { address, transactionHash } = await deploy(authenticator, options);
    if (transactionHash === undefined) {
      throw new Error("Authenticor deployment failed");
    } else {
      const receipt = ethers.provider.getTransactionReceipt(transactionHash);
      const deployerNonce = await ethers.provider.getTransactionCount(deployer);
      const deployTransaction: ContractTransaction = {
        ...options,
        ...receipt,
        // TODO - For some reason, even with these specified in deploy Options, we still get type errors.
        gasLimit: BigNumber.from("2000000"),
        gasPrice: BigNumber.from("21000000000"),
        data: "0",
        value: BigNumber.from(0),
        from: deployer,
        nonce: deployerNonce,
        hash: transactionHash,
        chainId: parseInt(await getChainId()),
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
