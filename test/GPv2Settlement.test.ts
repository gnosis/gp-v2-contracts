import { expect } from "chai";
import { Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import { allowanceManagerAddress, domain } from "../src/ts";

describe("GPv2Settlement", () => {
  const [deployer, owner, solver] = waffle.provider.getWallets();
  let settlement: Contract;
  let authenticator: Contract;

  beforeEach(async () => {
    const GPv2AllowListAuthentication = await ethers.getContractFactory(
      "GPv2AllowListAuthentication",
      deployer,
    );
    authenticator = await GPv2AllowListAuthentication.deploy(owner.address);

    const GPv2Settlement = await ethers.getContractFactory(
      "GPv2SettlementTestInterface",
      deployer,
    );
    settlement = await GPv2Settlement.deploy(authenticator.address);
  });

  describe("domainSeparator", () => {
    it("should have an EIP-712 domain separator", async () => {
      const { chainId } = await ethers.provider.getNetwork();

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
        deployer,
      );
      const settlement2 = await GPv2Settlement.deploy(authenticator.address);

      expect(await settlement.domainSeparatorTest()).to.not.equal(
        await settlement2.domainSeparatorTest(),
      );
    });
  });

  describe("allowanceManager", () => {
    it("should deploy an allowance manager", async () => {
      const GPv2AllowanceManager = await artifacts.readArtifact(
        "GPv2AllowanceManager",
      );

      const deployedAllowanceManager = await settlement.allowanceManagerTest();
      const code = await ethers.provider.send("eth_getCode", [
        deployedAllowanceManager,
        "latest",
      ]);

      // NOTE: The last 53 bytes in a deployed contract's bytecode contains the
      // contract metadata. Compare the deployed contract's metadata with the
      // compiled contract's metadata.
      // <https://docs.soliditylang.org/en/v0.7.5/metadata.html>
      const metadata = (bytecode: string) => bytecode.slice(-106);

      expect(metadata(code)).to.equal(
        metadata(GPv2AllowanceManager.deployedBytecode),
      );
    });

    it("should result in a deterministic address", async () => {
      expect(await settlement.allowanceManagerTest()).to.equal(
        allowanceManagerAddress(settlement.address),
      );
    });

    it("should have the settlement contract as the recipient", async () => {
      const ADDRESS_BYTE_LENGTH = 20;

      // NOTE: In order to avoid having the allowance manager add a public
      // accessor for its recipient just for testing, which would add minor
      // costs at both deployment time and runtime, just read the contract code
      // to get the immutable value.
      const buildInfo = await artifacts.getBuildInfo(
        "src/contracts/GPv2AllowanceManager.sol:GPv2AllowanceManager",
      );
      if (buildInfo === undefined) {
        throw new Error("missing GPv2AllowanceManager build info");
      }

      const [[recipientImmutableReference]] = Object.values(
        buildInfo.output.contracts["src/contracts/GPv2AllowanceManager.sol"]
          .GPv2AllowanceManager.evm.deployedBytecode.immutableReferences || {},
      );

      const deployedAllowanceManager = await settlement.allowanceManagerTest();
      const code = await ethers.provider.send("eth_getCode", [
        deployedAllowanceManager,
        "latest",
      ]);
      const recipient = ethers.utils.hexlify(
        ethers.utils
          .arrayify(code)
          .subarray(recipientImmutableReference.start)
          .subarray(recipientImmutableReference.length - ADDRESS_BYTE_LENGTH)
          .slice(0, ADDRESS_BYTE_LENGTH),
      );

      expect(ethers.utils.getAddress(recipient)).to.equal(settlement.address);
    });
  });

  describe("settle", () => {
    it("rejects transactions from non-solvers", async () => {
      await expect(settlement.settle([], [], 0, [], [], [])).to.be.revertedWith(
        "GPv2: not a solver",
      );
    });

    it("accepts transactions from solvers", async () => {
      await authenticator.connect(owner).addSolver(solver.address);
      // TODO - this will have to be changed when other constraints become active
      // and when settle function no longer reverts.
      await expect(
        settlement.connect(solver.address).settle([], [], 0, [], [], []),
      ).revertedWith("Final: not yet implemented");
    });
  });
});
