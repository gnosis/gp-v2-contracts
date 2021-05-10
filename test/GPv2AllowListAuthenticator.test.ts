import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

describe("GPv2AllowListAuthentication", () => {
  const [deployer, owner, manager, newManager, nobody, solver] =
    waffle.provider.getWallets();
  let authenticator: Contract;
  let initialization: Promise<unknown>;

  beforeEach(async () => {
    const GPv2AllowListAuthentication = await ethers.getContractFactory(
      "GPv2AllowListAuthenticationTestInterface",
      deployer,
    );

    // NOTE: This deploys the test interface contract which emulates being
    // proxied by an EIP-1967 compatible proxy for unit testing purposes.
    authenticator = await GPv2AllowListAuthentication.deploy(owner.address);
    initialization = authenticator.initializeManager(manager.address);
    await initialization;
  });

  describe("initializeManager", () => {
    it("should initialize the manager", async () => {
      expect(await authenticator.manager()).to.equal(manager.address);
    });

    it("deployer is not the manager", async () => {
      expect(await authenticator.manager()).not.to.be.equal(deployer.address);
    });

    it("owner is not the manager", async () => {
      expect(await authenticator.manager()).not.to.be.equal(owner.address);
    });

    it("should be idempotent", async () => {
      await expect(
        authenticator.initializeManager(nobody.address),
      ).to.revertedWith("initialized");

      // Also reverts when called by owner.
      await expect(
        authenticator.connect(owner).initializeManager(nobody.address),
      ).to.revertedWith("initialized");
    });

    it("should emit a ManagerChanged event", async () => {
      await expect(initialization)
        .to.emit(authenticator, "ManagerChanged")
        .withArgs(manager.address, ethers.constants.AddressZero);
    });
  });

  describe("setManager", () => {
    it("should be settable by current owner", async () => {
      await authenticator.connect(owner).setManager(newManager.address);
      expect(await authenticator.manager()).to.equal(newManager.address);
    });

    it("should be settable by current manager", async () => {
      await authenticator.connect(manager).setManager(newManager.address);
      expect(await authenticator.manager()).to.equal(newManager.address);
    });

    it("should revert when being set by unauthorized address", async () => {
      await expect(
        authenticator.connect(nobody).setManager(ethers.constants.AddressZero),
      ).to.be.revertedWith("not authorized");
    });

    it("should emit a ManagerChanged event", async () => {
      await expect(
        authenticator.connect(manager).setManager(newManager.address),
      )
        .to.emit(authenticator, "ManagerChanged")
        .withArgs(newManager.address, manager.address);
    });
  });

  describe("addSolver(address)", () => {
    it("should add a solver", async () => {
      await expect(authenticator.connect(manager).addSolver(solver.address)).to
        .not.be.reverted;
    });

    it("should not allow owner to add solver", async () => {
      await expect(
        authenticator.connect(owner).addSolver(solver.address),
      ).to.be.revertedWith("GPv2: caller not manager");
    });

    it("should not allow unauthorized address to add solver", async () => {
      await expect(
        authenticator.connect(nobody).addSolver(solver.address),
      ).to.be.revertedWith("GPv2: caller not manager");
    });

    it("should emit a SolverAdded event", async () => {
      await expect(authenticator.connect(manager).addSolver(solver.address))
        .to.emit(authenticator, "SolverAdded")
        .withArgs(solver.address);
    });
  });

  describe("removeSolver(address)", () => {
    it("should allow owner to remove solver", async () => {
      await expect(authenticator.connect(manager).removeSolver(solver.address))
        .to.not.be.reverted;
    });

    it("should not allow owner to add solver", async () => {
      await expect(
        authenticator.connect(owner).removeSolver(solver.address),
      ).to.be.revertedWith("GPv2: caller not manager");
    });

    it("should not allow unauthorized address to add solver", async () => {
      await expect(
        authenticator.connect(nobody).removeSolver(solver.address),
      ).to.be.revertedWith("GPv2: caller not manager");
    });

    it("should emit a SolverRemoved event", async () => {
      await expect(authenticator.connect(manager).removeSolver(solver.address))
        .to.emit(authenticator, "SolverRemoved")
        .withArgs(solver.address);
    });
  });

  describe("isSolver(address)", () => {
    it("returns true when given address is a recognized solver", async () => {
      await authenticator.connect(manager).addSolver(solver.address);
      expect(await authenticator.isSolver(solver.address)).to.equal(true);
    });

    it("returns false when given address is not a recognized solver", async () => {
      expect(await authenticator.isSolver(solver.address)).to.equal(false);
    });
  });
});
