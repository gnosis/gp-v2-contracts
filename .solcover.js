module.exports = {
  skipFiles: ["test/"],
  mocha: {
    grep: /^(?!E2E)./,
  },
};
