import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { deployments, ethers, waffle } from "hardhat";

import { SALT } from "../../src/ts";

import { deployTestContracts } from "./fixture";

describe("Upgrade Authenticator", () => {
  let authenticator: Contract;
  let deployer: Wallet;
  let owner: Wallet;
  let solver: Wallet;

  beforeEach(async () => {
    ({ authenticator, deployer, owner } = await deployTestContracts());
    // Solver isn't a named account
    solver = waffle.provider.getWallets()[2];
  });

  it("should upgrade authenticator", async () => {
    const GPv2AllowListAuthenticationV2 = await ethers.getContractFactory(
      "GPv2AllowListAuthenticationV2",
      deployer,
    );
    // Note that, before the upgrade this is actually the old instance
    const authenticatorV2 = GPv2AllowListAuthenticationV2.attach(
      authenticator.address,
    );
    // This method doesn't exist before upgrade
    await expect(authenticatorV2.newMethod()).to.be.reverted;

    await upgrade(
      "GPv2AllowListAuthentication",
      "GPv2AllowListAuthenticationV2",
    );
    // This method should exist on after upgrade
    expect(await authenticatorV2.newMethod()).to.equal(1337);
  });

  it("should preserve storage", async () => {
    await authenticator.connect(owner).addSolver(solver.address);

    // Upgrade after storage is set.
    await upgrade(
      "GPv2AllowListAuthentication",
      "GPv2AllowListAuthenticationV2",
    );

    const GPv2AllowListAuthenticationV2 = await ethers.getContractFactory(
      "GPv2AllowListAuthenticationV2",
      deployer,
    );
    const authenticatorV2 = GPv2AllowListAuthenticationV2.attach(
      authenticator.address,
    );
    // Both, the listed solvers and original manager are still set
    expect(await authenticatorV2.isSolver(solver.address)).to.equal(true);
    expect(await authenticatorV2.manager()).to.equal(owner.address);
  });

  async function upgrade(contractName: string, newContractName: string) {
    await deployments.deploy(contractName, {
      contract: newContractName,
      gasLimit: 2000000,
      from: owner.address,
      // deterministicDeployment: SALT,
      proxy: true,
    });
  }
});
