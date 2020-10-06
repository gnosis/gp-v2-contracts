import { usePlugin } from "@nomiclabs/buidler/config";

import { buidlerTestingAccounts } from "./test/resources/accounts";

usePlugin("@nomiclabs/buidler-waffle");
usePlugin("buidler-gas-reporter");

export default {
  paths: {
    artifacts: "build/artifacts",
    cache: "build/cache",
    sources: "src/contracts",
  },
  solc: {
    version: "0.6.12",
  },
  networks: {
    buidlerevm: {
      accounts: buidlerTestingAccounts(),
    },
    gasReporter: {
      url: "http://localhost:8545",
    },
  },
  gasReporter: {
    enabled: process.env.GAS_REPORTER,
    src: "src/contracts",
  },
};
