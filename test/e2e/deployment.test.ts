import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { artifacts } from "hardhat";

import {
  ContractName,
  DeploymentArguments,
  deterministicDeploymentAddress,
  implementationAddress,
} from "../../src/ts";
import { builtAndDeployedMetadataCoincide } from "../bytecode";

import { deployTestContracts } from "./fixture";

async function contractAddress<C extends ContractName>(
  contractName: C,
  ...deploymentArguments: DeploymentArguments<C>
): Promise<string> {
  const artifact = await artifacts.readArtifact(contractName);
  return deterministicDeploymentAddress(artifact, deploymentArguments);
}

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
          await implementationAddress(authenticator.address),
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
      expect(await contractAddress("GPv2AllowListAuthentication")).to.equal(
        await implementationAddress(authenticator.address),
      );
    });

    it("settlement", async () => {
      expect(
        await contractAddress("GPv2Settlement", authenticator.address),
      ).to.equal(settlement.address);
    });
  });

  describe("ownership", () => {
    it("authenticator has dedicated owner", async () => {
      expect(await authenticator.manager()).to.equal(owner.address);
    });
  });
});
