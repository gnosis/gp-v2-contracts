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
  await deploy(authenticator, {
    from: deployer,
    gasLimit: 2000000,
    deterministicDeployment: SALT,
    log: true,
    proxy: {
      owner,
      methodName: "setManager",
    },
    args: [owner],
  });
};

export default deployAuthenticator;
