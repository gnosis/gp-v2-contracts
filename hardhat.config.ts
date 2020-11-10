import "@nomiclabs/hardhat-waffle";

export default {
  paths: {
    artifacts: "build/artifacts",
    cache: "build/cache",
    sources: "src/contracts",
  },
  solidity: {
    version: "0.6.12",
  },
};
