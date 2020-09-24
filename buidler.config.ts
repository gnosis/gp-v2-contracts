import { usePlugin } from "@nomiclabs/buidler/config";

usePlugin("@nomiclabs/buidler-waffle");

export default {
  paths: {
    artifacts: "build/artifacts",
    cache: "build/cache",
    sources: "src/contracts",
  },
  solc: {
    version: "0.6.12",
  },
};
