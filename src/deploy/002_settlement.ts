import WETH from "canonical-weth/build/contracts/WETH9.json";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import Authorizer from "../../balancer/Authorizer.json";
import Vault from "../../balancer/Vault.json";
import { CONTRACT_NAMES, SALT } from "../ts/deploy";

const deploySettlement: DeployFunction = async function ({
  deployments,
  ethers,
  getNamedAccounts,
  network,
}: HardhatRuntimeEnvironment) {
  const { deployer, manager } = await getNamedAccounts();
  const { deploy, get } = deployments;

  const { authenticator, settlement } = CONTRACT_NAMES;
  const { address: authenticatorAddress } = await get(authenticator);

  let vaultAddress: string;
  if (network.name === "hardhat") {
    const { address: authorizerAddress } = await deploy("VaultAuthorizer", {
      from: deployer,
      contract: Authorizer,
      gasLimit: 3e6,
      args: [manager],
    });
    const { address: wethAddress } = await deploy("WETH", {
      from: deployer,
      contract: WETH,
      gasLimit: 3e6,
    });
    ({ address: vaultAddress } = await deploy("Vault", {
      from: deployer,
      contract: Vault,
      gasLimit: 8e6,
      args: [authorizerAddress, wethAddress, 0, 0],
    }));
  } else {
    // TODO(nlordell): Once the Vault is deployed, we need to get the address
    // based on the network.
    vaultAddress = ethers.constants.AddressZero;
  }

  await deploy(settlement, {
    from: deployer,
    gasLimit: 5e6,
    args: [authenticatorAddress, vaultAddress],
    deterministicDeployment: SALT,
    log: true,
  });
};

export default deploySettlement;
