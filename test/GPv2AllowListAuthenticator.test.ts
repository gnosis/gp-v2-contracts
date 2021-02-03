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

    authenticator = await GPv2AllowListAuthentication.deploy();
    await authenticator.initializeManager(owner.address);
  });

  describe("constructor", () => {
    it("should initialize the manager", async () => {
      expect(await authenticator.manager()).to.equal(owner.address);
    });

    it("ensures initializeManager is idempotent", async () => {
      await expect(
        authenticator.initializeManager(nonOwner.address),
      ).to.revertedWith("GPv2: already initialized");

      // Also reverts when called by owner.
      await expect(
        authenticator.connect(owner).initializeManager(nonOwner.address),
      ).to.revertedWith("GPv2: already initialized");
    });

    it("deployer is not the manager", async () => {
      expect(await authenticator.manager()).not.to.be.equal(deployer.address);
    });
  });

  describe("addSolver(address)", () => {
    it("should add a solver", async () => {
      await expect(authenticator.connect(owner).addSolver(solver.address)).to
        .not.be.reverted;
    });

    it("should not allow non-owner to add solver", async () => {
      await expect(
        authenticator.connect(nonOwner).addSolver(solver.address),
      ).to.be.revertedWith("GPv2: caller not manager");
    });
  });

  describe("removeSolver(address)", () => {
    it("should allow owner to remove solver", async () => {
      await expect(authenticator.connect(owner).removeSolver(solver.address)).to
        .not.be.reverted;
    });

    it("should not allow non-owner to remove solver", async () => {
      await expect(
        authenticator.connect(nonOwner).removeSolver(solver.address),
      ).to.be.revertedWith("GPv2: caller not manager");
    });
  });

  describe("isSolver(address)", () => {
    it("returns true when given address is a recognized solver", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      expect(await authenticator.isSolver(solver.address)).to.equal(true);
    });

    it("returns false when given address is not a recognized solver", async () => {
      expect(await authenticator.isSolver(solver.address)).to.equal(false);
    });
  });
});
