module.exports = {
  // TODO(nlordell): Stop skipping coverage for the vault relayer once it starts
  // actually doing stuff.
  skipFiles: ["test/", "src/contracts/GPv2VaultRelayer.sol"],
};
