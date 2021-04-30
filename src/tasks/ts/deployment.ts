import { Contract } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export async function getDeployedContract(
  name: string,
  { ethers, deployments }: HardhatRuntimeEnvironment,
): Promise<Contract> {
  const deployment = await deployments.get(name);

  return new Contract(deployment.address, deployment.abi).connect(
    ethers.provider,
  );
}
