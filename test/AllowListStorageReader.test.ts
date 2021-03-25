import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

import { AllowListReader } from "../src/ts/reader";

describe("AllowListStorageReader", () => {
  const [deployer, owner, nonSolver, ...solvers] = waffle.provider.getWallets();
  let authenticator: Contract;
  let reader: Contract;
  let allowListReader: AllowListReader;

  beforeEach(async () => {
    const GPv2AllowListAuthentication = await ethers.getContractFactory(
      "GPv2AllowListAuthentication",
      deployer,
    );
    const AllowListStorageReader = await ethers.getContractFactory(
      "AllowListStorageReader",
      deployer,
    );

    reader = await AllowListStorageReader.deploy();
    authenticator = await GPv2AllowListAuthentication.deploy();
    await authenticator.initializeManager(owner.address);
    allowListReader = new AllowListReader(authenticator, reader);
  });

  describe("areSolvers", () => {
    it("returns true when all specified addresses are solvers", async () => {
      await authenticator.connect(owner).addSolver(solvers[0].address);
      await authenticator.connect(owner).addSolver(solvers[1].address);
      expect(
        await allowListReader.areSolvers([
          solvers[0].address,
          solvers[1].address,
        ]),
      ).to.be.true;
    });

    it("returns false when one or more specified addresses are not solvers", async () => {
      await authenticator.connect(owner).addSolver(solvers[0].address);
      expect(
        await allowListReader.areSolvers([
          solvers[1].address,
          nonSolver.address,
        ]),
      ).to.be.false;
    });
  });
});
