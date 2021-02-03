import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { deployments, ethers } from "hardhat";

import { deployTestContracts } from "./fixture";

async function rejectError(
  promise: Promise<unknown>,
): Promise<Error | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err;
  }
}

async function upgrade(
  proxyOwner: Wallet,
  contractName: string,
  newContractName: string,
) {
  // Note that deterministic deployment and gasLimit are not needed/used here as deployment args.
  await deployments.deploy(contractName, {
    contract: newContractName,
    // From differs from initial deployment here since the proxy owner is the Authenticator manager.
    from: proxyOwner.address,
    proxy: true,
  });
}

describe("Upgrade Authenticator", () => {
  let authenticator: Contract;
  let deployer: Wallet;
  let owner: Wallet;
  let nonOwner: Wallet;
  let newManager: Wallet;
  let solver: Wallet;

  beforeEach(async () => {
    ({
      authenticator,
      deployer,
      owner,
      wallets: [nonOwner, newManager, solver],
    } = await deployTestContracts());
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
      owner,
      "GPv2AllowListAuthentication",
      "GPv2AllowListAuthenticationV2",
    );
    // This method should exist on after upgrade
    expect(await authenticatorV2.newMethod()).to.equal(1337);
  });

  it("should preserve storage", async () => {
    await authenticator.connect(owner).setManager(newManager.address);
    await authenticator.connect(newManager).addSolver(solver.address);

    // Upgrade after storage is set with **proxy owner**;
    await upgrade(
      owner,
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

    // Both, the listed solvers and updated manager are still set
    expect(await authenticatorV2.isSolver(solver.address)).to.equal(true);
    expect(await authenticatorV2.manager()).to.equal(newManager.address);
  });

  it("should revert when not upgrading with the authentication manager", async () => {
    await authenticator.connect(owner).setManager(newManager.address);
    expect(
      await rejectError(
        upgrade(
          newManager,
          "GPv2AllowListAuthentication",
          "GPv2AllowListAuthenticationV2",
        ),
      ),
    ).to.not.be.undefined;
  });

  it("should revert when not upgrading with the proxy owner", async () => {
    expect(
      await rejectError(
        upgrade(
          nonOwner,
          "GPv2AllowListAuthentication",
          "GPv2AllowListAuthenticationV2",
        ),
      ),
    ).to.not.be.undefined;
  });
});
