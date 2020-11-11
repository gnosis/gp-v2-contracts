import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

describe("GPv2Settlement", () => {
  let settlement: Contract;
  const [deployer, owner] = waffle.provider.getWallets();

  beforeEach(async () => {
    const GPv2Settlement = await ethers.getContractFactory(
      "GPv2SettlementTestInterface",
    );

    settlement = await GPv2Settlement.deploy();
  });

  describe("replayProtection", () => {
    it("should have a well defined replay protection signature mixer", async () => {
      const { chainId } = await waffle.provider.getNetwork();
      expect(chainId).to.not.equal(ethers.constants.Zero);

      expect(await settlement.replayProtection()).to.equal(
        ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ["string", "uint256", "address"],
            ["GPv2", chainId, settlement.address],
          ),
        ),
      );
    });

    it("should have a different replay protection for each deployment", async () => {
      const GPv2Settlement = await ethers.getContractFactory("GPv2Settlement");
      const settlement2 = await GPv2Settlement.deploy();

      expect(await settlement.replayProtection()).to.not.equal(
        await settlement2.replayProtection(),
      );
    });
  });

  describe("transferBalanceTo", () => {
    it("allows owner to transfer requested amount of token out of settlement contract", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);
      await token.mock.transfer.withArgs(owner.address, 1337).returns(true);

      await expect(
        settlement.transferBalanceTo(token.address, owner.address, 1337),
      ).to.not.be.reverted;
    });

    it("reverts on failed token transfer", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);
      await token.mock.transfer.withArgs(owner.address, 1337).reverts();

      await expect(
        settlement.transferBalanceTo(token.address, owner.address, 1337),
      ).to.be.reverted;
    });

    // TODO - once SafeERC20 Exists, this test should pass.
    // it("allows owner to transfer requested amount of token out of settlement contract", async () => {
    //   const token = await waffle.deployMockContract(deployer, IERC20.abi);
    //   await token.mock.transfer.withArgs(owner.address, 1337).returns(false);
    //   await expect(
    //     settlement.transferBalanceTo(token.address, owner.address, 1337),
    //   ).to.be.reverted;
    // });
  });
});
