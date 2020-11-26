import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { salt, logResult, contractNames } from "../ts/deploy";

const deploySettlement: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deployer } = await getNamedAccounts();
  const { deploy, log, get } = deployments;

  const { settlement, authenticator } = contractNames;

  const authenticatorAddress = (await get(authenticator)).address;

  const deployResult = await deploy(settlement, {
    from: deployer,
    gasLimit: 2000000,
    args: [authenticatorAddress],
    deterministicDeployment: salt,
  });

  await logResult(deployResult, settlement, network.name, log);
};

export default deploySettlement;
