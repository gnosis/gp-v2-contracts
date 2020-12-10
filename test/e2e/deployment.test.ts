import { expect } from "chai";
import { Contract, Wallet } from "ethers";

import { deterministicDeploymentAddress } from "../../src/ts";
import { builtAndDeployedMetadataCoincide } from "../bytecode";

import { deployTestContracts } from "./fixture";

describe("E2E: Deployment", () => {
  let owner: Wallet;
  let user: Wallet;

  let authenticator: Contract;
  let settlement: Contract;
  let allowanceManager: Contract;

  beforeEach(async () => {
    ({
      owner,
      wallets: [user],
      authenticator,
      settlement,
      allowanceManager,
    } = await deployTestContracts());

    authenticator.connect(user);
    settlement.connect(user);
    allowanceManager.connect(user);
  });

  describe("same built and deployed bytecode metadata", () => {
    it("authenticator", async () => {
      expect(
        await builtAndDeployedMetadataCoincide(
          authenticator.address,
          "GPv2AllowListAuthentication",
        ),
      ).to.be.true;
    });

    it("settlement", async () => {
      expect(
        await builtAndDeployedMetadataCoincide(
          settlement.address,
          "GPv2Settlement",
        ),
      ).to.be.true;
    });

    it("allowance manager", async () => {
      expect(
        await builtAndDeployedMetadataCoincide(
          allowanceManager.address,
          "GPv2AllowanceManager",
        ),
      ).to.be.true;
    });
  });

  describe("deterministic addresses", () => {
    it("authenticator", async () => {
      expect(
        await deterministicDeploymentAddress(
          "GPv2AllowListAuthentication",
          owner.address,
        ),
      ).to.equal(authenticator.address);
    });

    it("settlement", async () => {
      expect(
        await deterministicDeploymentAddress(
          "GPv2Settlement",
          authenticator.address,
        ),
      ).to.equal(settlement.address);
    });
  });

  describe("ownership", () => {
    it("authenticator has dedicated owner", async () => {
      expect(await authenticator.owner()).to.equal(owner.address);
    });
  });
});
