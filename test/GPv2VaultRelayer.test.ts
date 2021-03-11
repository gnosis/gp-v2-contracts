import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

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

  describe("transferFromAccounts", () => {
    it("should revert if not called by the creator", async () => {
      await expect(
        vaultRelayer.connect(nonCreator).transferFromAccounts([]),
      ).to.be.revertedWith("not creator");
    });

    it("should execute ERC20 and Vault transfers", async () => {
      const tokens = [
        await waffle.deployMockContract(deployer, IERC20.abi),
        await waffle.deployMockContract(deployer, IERC20.abi),
      ];

      const amount = ethers.utils.parseEther("13.37");
      await tokens[0].mock.transferFrom
        .withArgs(traders[0].address, creator.address, amount)
        .returns(true);
      await vault.mock.withdrawFromInternalBalance
        .withArgs([
          {
            token: tokens[1].address,
            amount,
            sender: traders[1].address,
            recipient: creator.address,
          },
        ])
        .returns();

      await expect(
        vaultRelayer.transferFromAccounts([
          {
            account: traders[0].address,
            token: tokens[0].address,
            amount,
            useInternalBalance: false,
          },
          {
            account: traders[1].address,
            token: tokens[1].address,
            amount,
            useInternalBalance: true,
          },
        ]),
      ).to.not.be.reverted;
    });

    it("should revert on failed ERC20 transfers", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);

      const amount = ethers.utils.parseEther("4.2");
      await token.mock.transferFrom
        .withArgs(traders[0].address, creator.address, amount)
        .revertsWithReason("test error");

      await expect(
        vaultRelayer.transferFromAccounts([
          {
            account: traders[0].address,
            token: token.address,
            amount,
            useInternalBalance: false,
          },
        ]),
      ).to.be.revertedWith("test error");
    });

    it("should revert on failed Vault withdrawals", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);

      const amount = ethers.utils.parseEther("4.2");
      await vault.mock.withdrawFromInternalBalance
        .withArgs([
          {
            token: token.address,
            amount,
            sender: traders[0].address,
            recipient: creator.address,
          },
        ])
        .revertsWithReason("test error");

      await expect(
        vaultRelayer.transferFromAccounts([
          {
            account: traders[0].address,
            token: token.address,
            amount,
            useInternalBalance: true,
          },
        ]),
      ).to.be.revertedWith("test error");
    });
  });
});
