import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import { encodeInTransfers } from "./encoding";

describe("GPv2VaultRelayer", () => {
  const [
    deployer,
    creator,
    nonCreator,
    ...traders
  ] = waffle.provider.getWallets();

  let vault: MockContract;
  let vaultRelayer: Contract;

  beforeEach(async () => {
    const IVault = await artifacts.readArtifact("IVault");
    vault = await waffle.deployMockContract(deployer, IVault.abi);

    const GPv2VaultRelayer = await ethers.getContractFactory(
      "GPv2VaultRelayer",
      creator,
    );
    vaultRelayer = await GPv2VaultRelayer.deploy(vault.address);
  });

  describe("transferIn", () => {
    it("should revert if not called by the creator", async () => {
      await expect(
        vaultRelayer.connect(nonCreator).transferIn([]),
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
        vaultRelayer.transferIn(
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
        vaultRelayer.transferIn(
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
