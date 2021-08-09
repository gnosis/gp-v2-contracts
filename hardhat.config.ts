import "@nomiclabs/hardhat-waffle";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@tenderly/hardhat-tenderly";

import dotenv from "dotenv";
import type { HttpNetworkUserConfig } from "hardhat/types";
import type { MochaOptions } from "mocha";
import yargs from "yargs";

import { setupTasks } from "./src/tasks";

const argv = yargs
  .option("network", {
    type: "string",
    default: "hardhat",
  })
  .help(false)
  .version(false)
  .parseSync();

// Load environment variables.
dotenv.config();
const { INFURA_KEY, MNEMONIC, PK, REPORT_GAS, MOCHA_CONF } = process.env;

const DEFAULT_MNEMONIC =
  "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";

const sharedNetworkConfig: HttpNetworkUserConfig = {};
if (PK) {
  sharedNetworkConfig.accounts = [PK];
} else {
  sharedNetworkConfig.accounts = {
    mnemonic: MNEMONIC || DEFAULT_MNEMONIC,
  };
}

if (["rinkeby", "mainnet"].includes(argv.network) && INFURA_KEY === undefined) {
  throw new Error(
    `Could not find Infura key in env, unable to connect to network ${argv.network}`,
  );
}

const mocha: MochaOptions = {};
let initialBaseFeePerGas: number | undefined = undefined;
switch (MOCHA_CONF) {
  case undefined:
    break;
  case "coverage":
    // End to end and task tests are skipped because:
    // - coverage tool does not play well with proxy deployment with
    //   hardhat-deploy
    // - coverage compiles without optimizer and, unlike Waffle, hardhat-deploy
    //   strictly enforces the contract size limits from EIP-170
    mocha.grep = /^(?!E2E|Task)/;
    // Note: unit is Wei, not GWei. This is a workaround to make the coverage
    // tool work with the London hardfork.
    initialBaseFeePerGas = 1;
    break;
  case "ignored in coverage":
    mocha.grep = /^E2E|Task/;
    break;
  default:
    throw new Error("Invalid MOCHA_CONF");
}

setupTasks();

export default {
  mocha,
  paths: {
    artifacts: "build/artifacts",
    cache: "build/cache",
    deploy: "src/deploy",
    sources: "src/contracts",
  },
  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000000,
          },
        },
      },
      {
        // Compiler for the Gas Token v1
        version: "0.4.11",
      },
    ],
  },
  networks: {
    hardhat: {
      blockGasLimit: 12.5e6,
      initialBaseFeePerGas,
    },
    mainnet: {
      ...sharedNetworkConfig,
      url: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
    },
    rinkeby: {
      ...sharedNetworkConfig,
      url: `https://rinkeby.infura.io/v3/${INFURA_KEY}`,
    },
    xdai: {
      ...sharedNetworkConfig,
      url: "https://xdai.poanetwork.dev",
    },
  },
  namedAccounts: {
    // Note: accounts defined by a number refer to the the accounts as configured
    // by the current network.
    deployer: 0,
    owner: {
      // The contract deployment addresses depend on the owner address.
      // To have the same addresses on all networks, the owner must be the same.
      default: "0x6Fb5916c0f57f88004d5b5EB25f6f4D77353a1eD",
      hardhat: 1,
    },
    manager: {
      default: "0x6Fb5916c0f57f88004d5b5EB25f6f4D77353a1eD",
      hardhat: 2,
    },
  },
  gasReporter: {
    enabled: REPORT_GAS ? true : false,
    currency: "USD",
    gasPrice: 21,
  },
};
