import { expect } from "chai";
import { Contract } from "ethers";
import { getNamedAccounts, run } from "hardhat";

import { proxyInterface } from "../../src/ts";
import { deployTestContracts } from "../e2e/fixture";

let authenticator: Contract;
let proxy: Contract;

describe("Task: transfer ownership", () => {
  beforeEach(async () => {
    ({ authenticator } = await deployTestContracts());
    proxy = proxyInterface(authenticator);
  });

  describe("transfers ownership", () => {
    it("transfers proxy ownership and resets the manager", async () => {
      const newOwner = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      await run("transfer-ownership", {
        newOwner,
        resetManager: true,
        dryRun: false,
      });

      expect(await authenticator.manager()).to.equal(newOwner);
      expect(await proxy.owner()).to.equal(newOwner);
    });

    it("only tansfers proxy ownership", async () => {
      const { manager } = await getNamedAccounts();
      const newOwner = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      await run("transfer-ownership", {
        newOwner,
        resetManager: false,
        dryRun: false,
      });

      expect(await authenticator.manager()).to.equal(manager);
      expect(await proxy.owner()).to.equal(newOwner);
    });

    it("does nothing when executing dry run", async () => {
      const { owner, manager } = await getNamedAccounts();
      await run("transfer-ownership", {
        newOwner: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        resetManager: true,
        dryRun: true,
      });

      expect(await authenticator.manager()).to.equal(manager);
      expect(await proxy.owner()).to.equal(owner);
    });
  });
});
