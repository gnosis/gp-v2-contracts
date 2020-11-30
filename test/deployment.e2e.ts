import { expect } from "chai";
import type { Contract } from "ethers";
import {
  ethers,
  deployments,
  getNamedAccounts,
  getUnnamedAccounts,
} from "hardhat";

import { allowanceManagerAddress } from "../src/ts";
import { deterministicDeploymentAddress } from "../src/ts/deploy";

import { builtAndDeployedMetadataCoincide } from "./bytecode";

describe("Deployment", () => {
  let owner: string;
  let user: string;

  let authenticator: Contract;
  let settlement: Contract;
  let allowanceManager: Contract;

  beforeEach(async () => {
    // execute all deployment scripts
    await deployments.fixture();

    ({ owner } = await getNamedAccounts());
    [user] = await getUnnamedAccounts();

    const authenticatorDeployment = await deployments.get(
      "GPv2AllowListAuthentication",
    );
    authenticator = await ethers.getContractAt(
      "GPv2AllowListAuthentication",
      authenticatorDeployment.address,
    );
    authenticator.connect(user);

    const settlementDeployment = await deployments.get("GPv2Settlement");
    settlement = await ethers.getContractAt(
      "GPv2Settlement",
      settlementDeployment.address,
    );
    settlement.connect(user);

    allowanceManager = await ethers.getContractAt(
      "GPv2AllowanceManager",
      await allowanceManagerAddress(settlement.address),
    );
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
          owner,
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
      expect(await authenticator.owner()).to.equal(owner);
    });
  });
});
