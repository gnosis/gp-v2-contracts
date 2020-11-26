import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { salt, logResult, contractNames } from "../ts/deploy";

const deployAuthenticator: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deployer, owner } = await getNamedAccounts();
  const { deploy, log } = deployments;

  const { authenticator } = contractNames;

  const deployResult = await deploy(authenticator, {
    from: deployer,
    gasLimit: 2000000,
    args: [owner],
    deterministicDeployment: salt,
  });

  await logResult(deployResult, authenticator, network.name, log);
};

export default deployAuthenticator;
