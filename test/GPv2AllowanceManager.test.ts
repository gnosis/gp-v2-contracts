import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

import { encodeInTransfers } from "./encoding";

describe("GPv2AllowanceManager", () => {
  const [
    deployer,
    creator,
    nonCreator,
    ...traders
  ] = waffle.provider.getWallets();

  let allowanceManager: Contract;

  beforeEach(async () => {
    const GPv2AllowanceManager = await ethers.getContractFactory(
      "GPv2AllowanceManager",
      creator,
    );

    allowanceManager = await GPv2AllowanceManager.deploy();
  });

  describe("transferIn", () => {
    it("should revert if not called by the creator", async () => {
      await expect(
        allowanceManager.connect(nonCreator).transferIn([]),
      ).to.be.revertedWith("not creator");
    });

    it("should execute ERC20 transfers", async () => {
      const tokens = [
        await waffle.deployMockContract(deployer, IERC20.abi),
        await waffle.deployMockContract(deployer, IERC20.abi),
      ];

      const amount = ethers.utils.parseEther("13.37");
      await tokens[0].mock.transferFrom
        .withArgs(traders[0].address, creator.address, amount)
        .returns(true);
      await tokens[1].mock.transferFrom
        .withArgs(traders[1].address, creator.address, amount)
        .returns(true);

      await expect(
        allowanceManager.transferIn(
          encodeInTransfers([
            {
              owner: traders[0].address,
              sellToken: tokens[0].address,
              sellAmount: amount,
            },
            {
              owner: traders[1].address,
              sellToken: tokens[1].address,
              sellAmount: amount,
            },
          ]),
        ),
      ).to.not.be.reverted;
    });

    it("should revert on failed ERC20 transfers", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);

      const amount = ethers.utils.parseEther("4.2");
      await token.mock.transferFrom
        .withArgs(traders[0].address, creator.address, amount)
        .revertsWithReason("test error");

      await expect(
        allowanceManager.transferIn(
          encodeInTransfers([
            {
              owner: traders[0].address,
              sellToken: token.address,
              sellAmount: amount,
            },
          ]),
        ),
      ).to.be.revertedWith("test error");
    });
  });
});
