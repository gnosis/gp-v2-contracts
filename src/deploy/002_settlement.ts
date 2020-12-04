import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { SALT, contractNames } from "../ts/deploy";

const deploySettlement: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) {
  const { deployer } = await getNamedAccounts();
  const { deploy, get } = deployments;

  const { settlement, authenticator } = contractNames;

  const authenticatorAddress = (await get(authenticator)).address;

  await deploy(settlement, {
    from: deployer,
    gasLimit: 2000000,
    args: [authenticatorAddress],
    deterministicDeployment: SALT,
    log: true,
  });
};

export default deploySettlement;
