import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

import { domain } from "../src/ts";

describe("GPv2Settlement", () => {
  const [owner, solver] = waffle.provider.getWallets();
  let settlement: Contract;
  let controller: Contract;

  beforeEach(async () => {
    const GPv2AccessControl = await ethers.getContractFactory(
      "GPv2AccessControl",
    );
    controller = await GPv2AccessControl.connect(owner).deploy();

    const GPv2Settlement = await ethers.getContractFactory(
      "GPv2SettlementTestInterface",
    );
    settlement = await GPv2Settlement.connect(owner).deploy(controller.address);
  });

  describe("domainSeparator", () => {
    it("should have an EIP-712 domain separator", async () => {
      const { chainId } = await waffle.provider.getNetwork();

      expect(chainId).to.not.equal(ethers.constants.Zero);
      expect(await settlement.domainSeparatorTest()).to.equal(
        ethers.utils._TypedDataEncoder.hashDomain(
          domain(chainId, settlement.address),
        ),
      );
    });

    it("should have a different replay protection for each deployment", async () => {
      const GPv2Settlement = await ethers.getContractFactory(
        "GPv2SettlementTestInterface",
      );
      const settlement2 = await GPv2Settlement.deploy(controller.address);

      expect(await settlement.domainSeparatorTest()).to.not.equal(
        await settlement2.domainSeparatorTest(),
      );
    });
  });

  describe("settle", () => {
    it("rejects transactions from non-solvers", async () => {
      await expect(settlement.settle([], [], 0, [], [], [])).to.be.revertedWith(
        "GPv2: not a solver",
      );
    });

    it("accepts transactions from solvers", async () => {
      await controller.addSolver(solver.address);
      // TODO - this will have to be changed when other contraints become active
      // and when settle function no longer reverts.
      await expect(
        settlement.connect(solver.address).settle([], [], 0, [], [], []),
      ).revertedWith("Final: not yet implemented");
    });
  });
});
