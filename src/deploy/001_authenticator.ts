import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { SALT, contractNames } from "../ts/deploy";

const deployAuthenticator: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) {
  const { deployer, owner } = await getNamedAccounts();
  const { deploy } = deployments;

  const { authenticator } = contractNames;

  await deploy(authenticator, {
    from: deployer,
    gasLimit: 2000000,
    args: [owner],
    deterministicDeployment: SALT,
    log: true,
  });
};

export default deployAuthenticator;
