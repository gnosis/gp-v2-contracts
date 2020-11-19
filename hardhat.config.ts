import "@nomiclabs/hardhat-waffle";

import dotenv from "dotenv";
import type { HttpNetworkUserConfig } from "hardhat/types";
import yargs from "yargs";

const argv = yargs
  .option("network", {
    type: "string",
    default: "hardhat",
  })
  .help(false)
  .version(false).argv;

// Load environment variables.
dotenv.config();

const DEFAULT_MNEMONIC =
  "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";

const sharedNetworkConfig: HttpNetworkUserConfig = {};
if (process.env.PK) {
  sharedNetworkConfig.accounts = [process.env.PK];
} else {
  sharedNetworkConfig.accounts = {
    mnemonic: process.env.MNEMONIC || DEFAULT_MNEMONIC,
  };
}

const infuraKey = process.env.INFURA_KEY || "";
if (
  ["rinkeby", "mainnet"].includes(argv.network) &&
  process.env.INFURA_KEY === undefined
) {
  throw new Error(
    `Could not find Infura key in env, unable to connect to network ${argv.network}`,
  );
}

export default {
  paths: {
    artifacts: "build/artifacts",
    cache: "build/cache",
    sources: "src/contracts",
  },
  solidity: {
    version: "0.6.12",
  },
  networks: {
    mainnet: {
      ...sharedNetworkConfig,
      url: `https://mainnet.infura.io/v3/${infuraKey}`,
    },
    rinkeby: {
      ...sharedNetworkConfig,
      url: "https://rinkeby.infura.io/v3/".concat(infuraKey),
    },
    xdai: {
      ...sharedNetworkConfig,
      url: "https://xdai.poanetwork.dev",
    },
  },
};
