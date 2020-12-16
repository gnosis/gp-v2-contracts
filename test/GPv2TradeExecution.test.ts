import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

import { encodeExecutedTrade } from "./encoding";

const NON_STANDARD_ERC20 = [
  "function transfer(address recipient, uint256 amount)",
  "function transferFrom(address sender, address recipient, uint256 amount)",
];

describe("GPv2TradeExecution", () => {
  const [deployer, recipient, ...traders] = waffle.provider.getWallets();

  let tradeExecution: Contract;

  beforeEach(async () => {
    const GPv2TradeExecution = await ethers.getContractFactory(
      "GPv2TradeExecutionTestInterface",
      recipient,
    );

    tradeExecution = await GPv2TradeExecution.deploy();
  });

  describe("transferSellAmountToRecipient", () => {
    const withoutBuy = {
      buyToken: ethers.constants.AddressZero,
      buyAmount: ethers.constants.Zero,
    };

    it("should transfer sell amount to recipient", async () => {
      const amount = ethers.utils.parseEther("13.37");

      const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await sellToken.mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .returns(true);
      const tradeExecutionTx = await tradeExecution.transferSellAmountToRecipientTest(
        encodeExecutedTrade({
          owner: traders[0].address,
          sellToken: sellToken.address,
          sellAmount: amount,
          ...withoutBuy,
        }),
        recipient.address,
      );
      await expect(tradeExecutionTx.wait()).to.not.be.reverted;
    });

    it("should revert on failed ERC20 transfers", async () => {
      const amount = ethers.utils.parseEther("4.2");

      const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await sellToken.mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .revertsWithReason("test error");

      await expect(
        tradeExecution.transferSellAmountToRecipientTest(
          encodeExecutedTrade({
            owner: traders[0].address,
            sellToken: sellToken.address,
            sellAmount: amount,
            ...withoutBuy,
          }),
          recipient.address,
        ),
      ).to.be.revertedWith("test error");
    });

    it("should revert when transfering a token with no contract at its address", async () => {
      await expect(
        tradeExecution.transferSellAmountToRecipientTest(
          encodeExecutedTrade({
            owner: traders[0].address,
            sellToken: traders[1].address,
            sellAmount: ethers.utils.parseEther("1.0"),
            ...withoutBuy,
          }),
          recipient.address,
        ),
      ).to.be.revertedWith("call to non-contract");
    });

    describe("Non-Standard ERC20 Tokens", () => {
      it("should not revert when ERC20 transfer has no return data", async () => {
        const amount = ethers.utils.parseEther("13.37");

        const sellToken = await waffle.deployMockContract(
          deployer,
          NON_STANDARD_ERC20,
        );
        await sellToken.mock.transferFrom
          .withArgs(traders[0].address, recipient.address, amount)
          .returns();
        const tradeExecutionTx = await tradeExecution.transferSellAmountToRecipientTest(
          encodeExecutedTrade({
            owner: traders[0].address,
            sellToken: sellToken.address,
            sellAmount: amount,
            ...withoutBuy,
          }),
          recipient.address,
        );
        await expect(tradeExecutionTx.wait()).to.not.be.reverted;
      });

      it("should revert when ERC20 transfer returns false", async () => {
        const amount = ethers.utils.parseEther("4.2");

        const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
        await sellToken.mock.transferFrom
          .withArgs(traders[0].address, recipient.address, amount)
          .returns(false);

        await expect(
          tradeExecution.transferSellAmountToRecipientTest(
            encodeExecutedTrade({
              owner: traders[0].address,
              sellToken: sellToken.address,
              sellAmount: amount,
              ...withoutBuy,
            }),
            recipient.address,
          ),
        ).to.be.revertedWith("ERC20 operation did not succeed");
      });
    });
  });

  describe("transferBuyAmountToOwner", () => {
    const withoutSell = {
      sellToken: ethers.constants.AddressZero,
      sellAmount: ethers.constants.Zero,
    };

    it("should transfer buy amount to sender", async () => {
      const amount = ethers.utils.parseEther("13.37");

      const buyToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await buyToken.mock.transfer
        .withArgs(traders[0].address, amount)
        .returns(true);
      const transferTx = await tradeExecution.transferBuyAmountToOwnerTest(
        encodeExecutedTrade({
          owner: traders[0].address,
          buyToken: buyToken.address,
          buyAmount: amount,
          ...withoutSell,
        }),
      );
      await expect(transferTx.wait()).to.not.be.reverted;
    });

    it("should revert on failed ERC20 transfers", async () => {
      const amount = ethers.utils.parseEther("4.2");

      const buyToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await buyToken.mock.transfer
        .withArgs(traders[0].address, amount)
        .revertsWithReason("test error");

      await expect(
        tradeExecution.transferBuyAmountToOwnerTest(
          encodeExecutedTrade({
            owner: traders[0].address,
            buyToken: buyToken.address,
            buyAmount: amount,
            ...withoutSell,
          }),
        ),
      ).to.be.revertedWith("test error");
    });

    it("should revert when transfering from a token with no contract at its address", async () => {
      await expect(
        tradeExecution.transferBuyAmountToOwnerTest(
          encodeExecutedTrade({
            owner: traders[0].address,
            buyToken: traders[1].address,
            buyAmount: ethers.utils.parseEther("1.0"),
            ...withoutSell,
          }),
        ),
      ).to.be.revertedWith("call to non-contract");
    });

    describe("Non-Standard ERC20 Tokens", () => {
      it("should not revert when ERC20 trasnfer has no return data", async () => {
        const amount = ethers.utils.parseEther("13.37");

        const buyToken = await waffle.deployMockContract(
          deployer,
          NON_STANDARD_ERC20,
        );
        await buyToken.mock.transfer
          .withArgs(traders[0].address, amount)
          .returns();
        const transferTx = await tradeExecution.transferBuyAmountToOwnerTest(
          encodeExecutedTrade({
            owner: traders[0].address,
            buyToken: buyToken.address,
            buyAmount: amount,
            ...withoutSell,
          }),
        );
        await expect(transferTx.wait()).to.not.be.reverted;
      });

      it("should revert when ERC20 transfer returns false", async () => {
        const amount = ethers.utils.parseEther("4.2");

        const buyToken = await waffle.deployMockContract(deployer, IERC20.abi);
        await buyToken.mock.transfer
          .withArgs(traders[0].address, amount)
          .returns(false);

        await expect(
          tradeExecution.transferBuyAmountToOwnerTest(
            encodeExecutedTrade({
              owner: traders[0].address,
              buyToken: buyToken.address,
              buyAmount: amount,
              ...withoutSell,
            }),
          ),
        ).to.be.revertedWith("ERC20 operation did not succeed");
      });
    });
  });
});
