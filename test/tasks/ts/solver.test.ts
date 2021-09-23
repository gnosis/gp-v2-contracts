import { expect } from "chai";
import { Contract, Wallet } from "ethers";

import { getSolvers } from "../../../src/tasks/ts/solver";
import { deployTestContracts } from "../../e2e/fixture";

let manager: Wallet;
let wallets: Wallet[];

let authenticator: Contract;

describe("Task helper: getSolvers", () => {
  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({ manager, authenticator, wallets } = deployment);
  });

  it("lists solvers", async () => {
    await authenticator.connect(manager).addSolver(wallets[0].address);
    await authenticator.connect(manager).addSolver(wallets[1].address);
    const list = await getSolvers(authenticator);
    expect(list).to.have.length(2);
    expect(list).to.include(wallets[0].address);
    expect(list).to.include(wallets[1].address);
  });

  it("does not show removed solvers", async () => {
    await authenticator.connect(manager).addSolver(wallets[0].address);
    await authenticator.connect(manager).removeSolver(wallets[0].address);
    const list = await getSolvers(authenticator);
    expect(list).to.have.length(0);
  });
});
