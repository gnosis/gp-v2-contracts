module.exports = {
  compilers: {
    solc: {
      version: "^0.7.0", // A version or constraint - Ex. "^0.5.0"
      // Can also be set to "native" to use a native solc
      parser: "solcjs", // Leverages solc-js purely for speedy parsing
      settings: {
        optimizer: {
          enabled: false,
          runs: 1, // Optimize for how many times you intend to run the code
        },
        evmVersion: "petersburg",
      },
    },
  },
};
