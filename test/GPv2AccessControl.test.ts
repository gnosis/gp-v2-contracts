import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

describe("GPv2AccessControl", () => {
  const [owner, nonOwner, solver] = waffle.provider.getWallets();
  let accessController: Contract;

  beforeEach(async () => {
    const GPv2AccessControl = await ethers.getContractFactory(
      "GPv2AccessControl",
    );

    // Owner will default to admin account declared above.
    accessController = await GPv2AccessControl.deploy();
  });

  describe("constructor", () => {
    it("should set deployer as owner", async () => {
      expect(await accessController.owner()).to.equal(owner.address);
    });
  });

  describe("addSolver", () => {
    it("should allow to add solver", async () => {
      await expect(accessController.addSolver(solver.address)).to.not.be
        .reverted;
    });

    it("should not allow non-owner to add solver", async () => {
      await expect(
        accessController.connect(nonOwner).addSolver(solver.address),
      ).to.be.revertedWith("caller is not the owner");
    });
  });

  describe("removeSolver", () => {
    it("should allow owner to add solver", async () => {
      await expect(accessController.connect(owner).removeSolver(solver.address))
        .to.not.be.reverted;
    });

    it("should not allow non-owner to remove solver", async () => {
      await expect(
        accessController.connect(nonOwner).removeSolver(solver.address),
      ).to.be.revertedWith("caller is not the owner");
    });
  });

  describe("View Methods", () => {
    describe("isSolver", () => {
      it("returns true when given address is a recognized solver", async () => {
        await accessController.addSolver(solver.address);
        expect(await accessController.isSolver(solver.address)).to.equal(true);
      });

      it("returns false when given address is not a recognized solver", async () => {
        expect(await accessController.isSolver(solver.address)).to.equal(false);
      });
    });

    describe("getSolverAt", () => {
      it("returns with index error when appropriate", async () => {
        await expect(accessController.getSolverAt(0)).to.be.revertedWith(
          "EnumerableSet: index out of bounds",
        );
        await accessController.addSolver(solver.address);
        await expect(accessController.getSolverAt(1)).to.be.revertedWith(
          "EnumerableSet: index out of bounds",
        );
      });

      it("returns expected address when called correctly", async () => {
        await accessController.addSolver(solver.address);
        expect(await accessController.getSolverAt(0)).to.equal(solver.address);
      });

      it("returns expected address when called correctly", async () => {
        await accessController.addSolver(solver.address);
        expect(await accessController.getSolverAt(0)).to.equal(solver.address);
      });
    });

    describe("numSolvers", () => {
      it("returns 0 when there are no solvers", async () => {
        expect(await accessController.numSolvers()).to.equal(0);
      });

      it("returns 1 when there is one solver", async () => {
        await accessController.addSolver(solver.address);
        expect(await accessController.numSolvers()).to.equal(1);
      });
    });
  });
});
