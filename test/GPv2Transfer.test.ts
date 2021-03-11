import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import { BUY_ETH_ADDRESS } from "../src/ts";

describe("GPv2Transfer", () => {
  const [deployer, recipient, ...traders] = waffle.provider.getWallets();

  let transfer: Contract;
  let vault: MockContract;
  let token: MockContract;

  beforeEach(async () => {
    const GPv2Transfer = await ethers.getContractFactory(
      "GPv2TransferTestInterface",
    );
    transfer = await GPv2Transfer.deploy();

    const IVault = await artifacts.readArtifact("IVault");
    vault = await waffle.deployMockContract(deployer, IVault.abi);
    token = await waffle.deployMockContract(deployer, IERC20.abi);
  });

  describe("transferToRecipient", () => {
    const amount = ethers.utils.parseEther("13.37");

    it("should transfer external amount to recipient", async () => {
      await token.mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .returns(true);
      await expect(
        transfer.transferToRecipientTest(vault.address, recipient.address, [
          {
            account: traders[0].address,
            token: token.address,
            amount: amount,
            useInternalBalance: false,
          },
        ]),
      ).to.not.be.reverted;
    });

    it("should transfer internal amount to recipient", async () => {
      await vault.mock.withdrawFromInternalBalance
        .withArgs([
          {
            token: token.address,
            amount,
            sender: traders[0].address,
            recipient: recipient.address,
          },
        ])
        .returns();
      await expect(
        transfer.transferToRecipientTest(vault.address, recipient.address, [
          {
            account: traders[0].address,
            token: token.address,
            amount,
            useInternalBalance: true,
          },
        ]),
      ).to.not.be.reverted;
    });

    it("should transfer many external and internal amounts to recipient", async () => {
      const transfers = traders.map((trader, i) => ({
        account: trader.address,
        token: token.address,
        amount,
        useInternalBalance: (i & 1) == 1,
      }));

      const [externalTransfers, internalTransfers] = [
        transfers.filter((transfer) => !transfer.useInternalBalance),
        transfers.filter((transfer) => transfer.useInternalBalance),
      ];
      // NOTE: Make sure we have at least 2 of each flavour of transfer, this
      // avoids this test not achieving what it expects because of reasonable
      // changes elsewhere in the file (like only having 3 traders for example).
      expect(externalTransfers).to.have.length.above(1);
      expect(internalTransfers).to.have.length.above(1);

      for (const { account } of externalTransfers) {
        await token.mock.transferFrom
          .withArgs(account, recipient.address, amount)
          .returns(true);
      }
      await vault.mock.withdrawFromInternalBalance
        .withArgs(
          internalTransfers.map(({ account }) => ({
            token: token.address,
            amount,
            sender: account,
            recipient: recipient.address,
          })),
        )
        .returns();

      await expect(
        transfer.transferToRecipientTest(
          vault.address,
          recipient.address,
          transfers,
        ),
      ).to.not.be.reverted;
    });

    it("reverts when mistakenly trying to transfer Ether", async () => {
      for (const useInternalBalance of [false, true]) {
        await expect(
          transfer.transferToRecipientTest(vault.address, recipient.address, [
            {
              account: traders[0].address,
              token: BUY_ETH_ADDRESS,
              amount: amount,
              useInternalBalance,
            },
          ]),
        ).to.be.revertedWith("GPv2: cannot transfer native ETH");
      }
    });

    it("should revert on failed ERC20 transfers", async () => {
      await token.mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .revertsWithReason("test error");

      await expect(
        transfer.transferToRecipientTest(vault.address, recipient.address, [
          {
            account: traders[0].address,
            token: token.address,
            amount: amount,
            useInternalBalance: false,
          },
        ]),
      ).to.be.revertedWith("test error");
    });

    it("should revert on failed Vault withdrawal", async () => {
      await vault.mock.withdrawFromInternalBalance
        .withArgs([
          {
            token: token.address,
            amount,
            sender: traders[0].address,
            recipient: recipient.address,
          },
        ])
        .revertsWithReason("test error");

      await expect(
        transfer.transferToRecipientTest(vault.address, recipient.address, [
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
