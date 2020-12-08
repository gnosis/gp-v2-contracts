import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, waffle } from "hardhat";

const readStorage = async (
  base: Contract,
  reader: Contract,
  method: string,
  parameters?: (string | number | BigNumber)[],
) => {
  const encodedCall = reader.interface.encodeFunctionData(
    method,
    parameters || [],
  );
  const resultBytes = await base.callStatic.simulateDelegatecall(
    reader.address,
    encodedCall,
  );
  return reader.interface.decodeFunctionResult(method, resultBytes)[0];
};

describe("GPv2AllowListAuthentication", () => {
  const [deployer, owner, solver] = waffle.provider.getWallets();
  let authenticator: Contract;
  let reader: Contract;

  beforeEach(async () => {
    const GPv2AllowListAuthentication = await ethers.getContractFactory(
      "GPv2AllowListAuthentication",
      deployer,
    );
    const AllowListStorageReader = await ethers.getContractFactory(
      "AllowListStorageReader",
      deployer,
    );

    reader = await AllowListStorageReader.deploy();
    authenticator = await GPv2AllowListAuthentication.deploy(owner.address);
  });

  describe("getSolverAt(uint256)", () => {
    it("Can read solver at index", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      const result = await readStorage(authenticator, reader, "getSolverAt", [
        0,
      ]);

      expect(solver.address).to.be.equal(result);
    });

    it("returns with index error when appropriate", async () => {
      await expect(
        readStorage(authenticator, reader, "getSolverAt", [0]),
      ).to.be.revertedWith("EnumerableSet: index out of bounds");

      await authenticator.connect(owner).addSolver(solver.address);

      await expect(
        readStorage(authenticator, reader, "getSolverAt", [1]),
      ).to.be.revertedWith("EnumerableSet: index out of bounds");
    });

    it("returns expected address when called correctly", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      const result = await readStorage(authenticator, reader, "getSolverAt", [
        0,
      ]);
      expect(result).to.equal(solver.address);
    });
  });

  describe("numSolvers()", () => {
    it("returns 0 when there are no solvers", async () => {
      const result = await readStorage(authenticator, reader, "numSolvers");
      expect(result).to.equal(BigNumber.from(0));
    });

    it("returns 1 when there is one solver", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      const result = await readStorage(authenticator, reader, "numSolvers");
      expect(result).to.equal(BigNumber.from(1));
    });
  });
});
