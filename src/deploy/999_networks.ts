import { promises as fs } from "fs";
import path from "path";

import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const NETWORKS_PATH = path.join(__dirname, "../../networks.json");
const INDENT = "  ";

type Networks = Record<string, Network>;
type Network = Record<number, DeploymentRecord>;

interface DeploymentRecord {
  address: string;
  transactionHash?: string;
}

const updateNetworks: DeployFunction = async function ({
  deployments,
  getChainId,
  ethers,
  network,
}: HardhatRuntimeEnvironment) {
  if (network.name === "hardhat") {
    return;
  }

  console.log("updating 'networks.json'...");

  const chainId = parseInt(await getChainId());
  const networks: Networks = JSON.parse(
    await fs.readFile(NETWORKS_PATH, "utf-8"),
  );

  const initializeRecord = (contractName: string, address: string) => {
    networks[contractName] = networks[contractName] || {};
    return (networks[contractName][chainId] = {
      ...networks[contractName][chainId],
      address,
    });
  };

  for (const [name, { address, transactionHash }] of Object.entries(
    await deployments.all(),
  )) {
    const record = initializeRecord(name, address);

    // NOTE: Preserve transaction hash in case there is no new deployment
    // because the contract bytecode did not change.
    record.transactionHash = transactionHash || record.transactionHash;
  }

  const settlement = await ethers.getContractAt(
    "GPv2Settlement",
    networks["GPv2Settlement"][chainId].address,
  );
  initializeRecord("GPv2AllowanceManager", await settlement.allowanceManager());

  await fs.writeFile(NETWORKS_PATH, JSON.stringify(networks, null, INDENT));
};

export default updateNetworks;
