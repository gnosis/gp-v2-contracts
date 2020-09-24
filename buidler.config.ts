import { task, usePlugin } from "@nomiclabs/buidler/config";

usePlugin("@nomiclabs/buidler-waffle");

export default {
  paths: {
    sources: "src/contracts",
  },
  solc: {
    version: "0.6.12",
  },
};
