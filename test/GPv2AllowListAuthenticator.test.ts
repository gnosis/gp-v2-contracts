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

  describe("addSolver", () => {
    it("should add a solver", async () => {
      await expect(authenticator.connect(owner).addSolver(solver.address)).to
        .not.be.reverted;
    });

    it("should not allow non-owner to add solver", async () => {
      await expect(
        authenticator.connect(nonOwner).addSolver(solver.address),
      ).to.be.revertedWith("caller is not the owner");
    });
  });

  describe("removeSolver", () => {
    it("should allow owner to remove solver", async () => {
      await expect(authenticator.connect(owner).removeSolver(solver.address)).to
        .not.be.reverted;
    });

    it("should not allow non-owner to remove solver", async () => {
      await expect(
        authenticator.connect(nonOwner).removeSolver(solver.address),
      ).to.be.revertedWith("caller is not the owner");
    });
  });

  describe("View Methods", () => {
    describe("isSolver", () => {
      it("returns true when given address is a recognized solver", async () => {
        await authenticator.connect(owner).addSolver(solver.address);
        expect(await authenticator.isSolver(solver.address)).to.equal(true);
      });

      it("returns false when given address is not a recognized solver", async () => {
        expect(await authenticator.isSolver(solver.address)).to.equal(false);
      });
    });

    describe("getSolverAt", () => {
      it("returns with index error when appropriate", async () => {
        await expect(authenticator.getSolverAt(0)).to.be.revertedWith(
          "EnumerableSet: index out of bounds",
        );
        await authenticator.connect(owner).addSolver(solver.address);
        await expect(authenticator.getSolverAt(1)).to.be.revertedWith(
          "EnumerableSet: index out of bounds",
        );
      });

      it("returns expected address when called correctly", async () => {
        await authenticator.connect(owner).addSolver(solver.address);
        expect(await authenticator.getSolverAt(0)).to.equal(solver.address);
      });
    });

    describe("numSolvers", () => {
      it("returns 0 when there are no solvers", async () => {
        expect(await authenticator.numSolvers()).to.equal(0);
      });

      it("returns 1 when there is one solver", async () => {
        await authenticator.connect(owner).addSolver(solver.address);
        expect(await authenticator.numSolvers()).to.equal(1);
      });
    });
  });
});
