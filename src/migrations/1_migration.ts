import type { Network } from "hardhat/types";

import type { Migration } from "./deploy";

const migration: Migration = async (
  deployer: null,
  network: Network,
): Promise<void> => {
  console.log("1", network.name);
};

export default migration;
