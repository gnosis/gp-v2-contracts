import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

import { BUY_ETH_ADDRESS } from "../src/ts";

import { NON_STANDARD_ERC20 } from "./ERC20";

const RECEIVER_SAME_AS_OWNER = ethers.constants.AddressZero;

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
      receiver: ethers.constants.AddressZero,
      buyToken: ethers.constants.AddressZero,
      buyAmount: ethers.constants.Zero,
    };

    it("should transfer sell amount to recipient", async () => {
      const amount = ethers.utils.parseEther("13.37");

      const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await sellToken.mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .returns(true);

      await expect(
        tradeExecution.transferSellAmountToRecipientTest(
          {
            owner: traders[0].address,
            sellToken: sellToken.address,
            sellAmount: amount,
            ...withoutBuy,
          },
          recipient.address,
        ),
      ).to.not.be.reverted;
    });

    it("should revert on failed ERC20 transfers", async () => {
      const amount = ethers.utils.parseEther("4.2");

      const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await sellToken.mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .revertsWithReason("test error");

      await expect(
        tradeExecution.transferSellAmountToRecipientTest(
          {
            owner: traders[0].address,
            sellToken: sellToken.address,
            sellAmount: amount,
            ...withoutBuy,
          },
          recipient.address,
        ),
      ).to.be.revertedWith("test error");
    });

    it("does not revert when transfering a token with no contract at its address", async () => {
      await expect(
        tradeExecution.transferSellAmountToRecipientTest(
          {
            owner: traders[0].address,
            sellToken: traders[1].address,
            sellAmount: ethers.utils.parseEther("1.0"),
            ...withoutBuy,
          },
          recipient.address,
        ),
      ).not.to.be.reverted;
    });

    it("reverts when mistakenly trying to sell ETH using the marker buy Ether address", async () => {
      await expect(
        tradeExecution.transferSellAmountToRecipientTest(
          {
            owner: traders[0].address,
            sellToken: BUY_ETH_ADDRESS,
            sellAmount: ethers.utils.parseEther("1.0"),
            ...withoutBuy,
          },
          recipient.address,
        ),
      ).to.be.revertedWith("GPv2: cannot transfer native ETH");
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

        await expect(
          tradeExecution.transferSellAmountToRecipientTest(
            {
              owner: traders[0].address,
              sellToken: sellToken.address,
              sellAmount: amount,
              ...withoutBuy,
            },
            recipient.address,
          ),
        ).to.not.be.reverted;
      });

      it("should revert when ERC20 transfer returns false", async () => {
        const amount = ethers.utils.parseEther("4.2");

        const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
        await sellToken.mock.transferFrom
          .withArgs(traders[0].address, recipient.address, amount)
          .returns(false);

        await expect(
          tradeExecution.transferSellAmountToRecipientTest(
            {
              owner: traders[0].address,
              sellToken: sellToken.address,
              sellAmount: amount,
              ...withoutBuy,
            },
            recipient.address,
          ),
        ).to.be.revertedWith("failed transferFrom");
      });
    });
  });

  describe("transferBuyAmountToOwner", () => {
    const withoutSell = {
      sellToken: ethers.constants.AddressZero,
      sellAmount: ethers.constants.Zero,
    };

    it("should transfer buy amount to receiver", async () => {
      const [owner, receiver] = traders;

      const amount = ethers.utils.parseEther("13.37");

      const buyToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await buyToken.mock.transfer
        .withArgs(receiver.address, amount)
        .returns(true);

      await expect(
        tradeExecution.transferBuyAmountToOwnerTest({
          owner: owner.address,
          receiver: receiver.address,
          buyToken: buyToken.address,
          buyAmount: amount,
          ...withoutSell,
        }),
      ).to.not.be.reverted;
    });

    it("should transfer buy amount to owner when receiver is not set", async () => {
      const amount = ethers.utils.parseEther("13.37");

      const buyToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await buyToken.mock.transfer
        .withArgs(traders[0].address, amount)
        .returns(true);

      await expect(
        tradeExecution.transferBuyAmountToOwnerTest({
          owner: traders[0].address,
          receiver: RECEIVER_SAME_AS_OWNER,
          buyToken: buyToken.address,
          buyAmount: amount,
          ...withoutSell,
        }),
      ).to.not.be.reverted;
    });

    it("should revert on failed ERC20 transfers", async () => {
      const amount = ethers.utils.parseEther("4.2");

      const buyToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await buyToken.mock.transfer
        .withArgs(traders[0].address, amount)
        .revertsWithReason("test error");

      await expect(
        tradeExecution.transferBuyAmountToOwnerTest({
          owner: traders[0].address,
          receiver: RECEIVER_SAME_AS_OWNER,
          buyToken: buyToken.address,
          buyAmount: amount,
          ...withoutSell,
        }),
      ).to.be.revertedWith("test error");
    });

    it("should not revert when transfering from a token with no contract at its address", async () => {
      await expect(
        tradeExecution.transferBuyAmountToOwnerTest({
          owner: traders[0].address,
          receiver: RECEIVER_SAME_AS_OWNER,
          buyToken: traders[1].address,
          buyAmount: ethers.utils.parseEther("1.0"),
          ...withoutSell,
        }),
      ).not.to.be.reverted;
    });

    it("should transfer Ether to receiver if the marker address is used", async () => {
      const [owner, receiver] = traders;

      const amount = ethers.utils.parseEther("1.0");
      const initialBalance = await receiver.getBalance();

      await deployer.sendTransaction({
        to: tradeExecution.address,
        value: amount,
      });

      await tradeExecution.transferBuyAmountToOwnerTest({
        owner: owner.address,
        receiver: receiver.address,
        buyToken: BUY_ETH_ADDRESS,
        buyAmount: amount,
        ...withoutSell,
      });

      expect(await receiver.getBalance()).to.deep.equal(
        initialBalance.add(amount),
      );
    });

    it("should transfer Ether if to owner the marker address is used when receiver is not set", async () => {
      const amount = ethers.utils.parseEther("1.0");
      const initialBalance = await traders[0].getBalance();

      await deployer.sendTransaction({
        to: tradeExecution.address,
        value: amount,
      });

      await tradeExecution.transferBuyAmountToOwnerTest({
        owner: traders[0].address,
        receiver: RECEIVER_SAME_AS_OWNER,
        buyToken: BUY_ETH_ADDRESS,
        buyAmount: amount,
        ...withoutSell,
      });

      expect(await traders[0].getBalance()).to.deep.equal(
        initialBalance.add(amount),
      );
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

        await expect(
          tradeExecution.transferBuyAmountToOwnerTest({
            owner: traders[0].address,
            receiver: RECEIVER_SAME_AS_OWNER,
            buyToken: buyToken.address,
            buyAmount: amount,
            ...withoutSell,
          }),
        ).to.not.be.reverted;
      });

      it("should revert when ERC20 transfer returns false", async () => {
        const amount = ethers.utils.parseEther("4.2");

        const buyToken = await waffle.deployMockContract(deployer, IERC20.abi);
        await buyToken.mock.transfer
          .withArgs(traders[0].address, amount)
          .returns(false);

        await expect(
          tradeExecution.transferBuyAmountToOwnerTest({
            owner: traders[0].address,
            receiver: RECEIVER_SAME_AS_OWNER,
            buyToken: buyToken.address,
            buyAmount: amount,
            ...withoutSell,
          }),
        ).to.be.revertedWith("failed transfer");
      });
    });
  });
});
