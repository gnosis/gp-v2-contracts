import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, waffle } from "hardhat";

import { AllowListReader } from "../src/ts/reader";

describe("GPv2AllowListAuthentication", () => {
  const [deployer, owner, solver] = waffle.provider.getWallets();
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
    authenticator = await GPv2AllowListAuthentication.deploy(owner.address);
    allowListReader = new AllowListReader(authenticator, reader);
  });

  describe("getSolverAt(uint256)", () => {
    it("returns expected address when called correctly", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      expect(await allowListReader.getSolverAt(0)).to.equal(solver.address);
    });

    it("returns with index error when appropriate", async () => {
      await expect(allowListReader.getSolverAt(0)).to.be.revertedWith(
        "EnumerableSet: index out of bounds",
      );

      await authenticator.connect(owner).addSolver(solver.address);

      await expect(allowListReader.getSolverAt(1)).to.be.revertedWith(
        "EnumerableSet: index out of bounds",
      );
    });
  });

  describe("numSolvers()", () => {
    it("returns 0 when there are no solvers", async () => {
      expect(await allowListReader.numSolvers()).to.equal(BigNumber.from(0));
    });

    it("returns 1 when there is one solver", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      expect(await allowListReader.numSolvers()).to.equal(BigNumber.from(1));
    });
  });
});
