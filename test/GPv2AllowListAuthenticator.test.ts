import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

describe("GPv2AllowListAuthentication", () => {
  const [deployer, owner, nonOwner, solver] = waffle.provider.getWallets();
  let authenticator: Contract;

  beforeEach(async () => {
    const GPv2AllowListAuthentication = await ethers.getContractFactory(
      "GPv2AllowListAuthentication",
      deployer,
    );

    authenticator = await GPv2AllowListAuthentication.deploy(owner.address);
  });

  describe("constructor", () => {
    it("should set the owner", async () => {
      expect(await authenticator.owner()).to.equal(owner.address);
    });
    it("deployer is not the owner", async () => {
      expect(await authenticator.owner()).not.to.be.equal(deployer.address);
    });
  });

  describe("addSolver(address)", () => {
    it("should add a solver", async () => {
      const tx = await authenticator.connect(owner).addSolver(solver.address);
      await expect(tx.wait()).to.not.be.reverted;
    });

    it("should not allow non-owner to add solver", async () => {
      await expect(
        authenticator.connect(nonOwner).addSolver(solver.address),
      ).to.be.revertedWith("caller is not the owner");
    });
  });

  describe("removeSolver(address)", () => {
    it("should allow owner to remove solver", async () => {
      const tx = await authenticator
        .connect(owner)
        .removeSolver(solver.address);
      await expect(tx.wait()).to.not.be.reverted;
    });

    it("should not allow non-owner to remove solver", async () => {
      await expect(
        authenticator.connect(nonOwner).removeSolver(solver.address),
      ).to.be.revertedWith("caller is not the owner");
    });
  });

  describe("isSolver(address)", () => {
    it("returns true when given address is a recognized solver", async () => {
      (await authenticator.connect(owner).addSolver(solver.address)).wait();
      expect(await authenticator.isSolver(solver.address)).to.equal(true);
    });

    it("returns false when given address is not a recognized solver", async () => {
      expect(await authenticator.isSolver(solver.address)).to.equal(false);
    });
  });
});
