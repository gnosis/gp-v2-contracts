import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

export interface ExecutedTrade {
  owner: string;
  sellToken: string;
  buyToken: string;
  sellAmount: BigNumber;
  buyAmount: BigNumber;
}

export function composeExecutedTrade(
  trade: ExecutedTrade,
): [string, string, string, BigNumber, BigNumber] {
  return [
    trade.owner,
    trade.sellToken,
    trade.buyToken,
    trade.sellAmount,
    trade.buyAmount,
  ];
}

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

      await expect(
        tradeExecution.transferSellAmountToRecipientTest(
          composeExecutedTrade({
            owner: traders[0].address,
            sellToken: sellToken.address,
            sellAmount: amount,
            ...withoutBuy,
          }),
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
          composeExecutedTrade({
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
          composeExecutedTrade({
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

        const { abi } = await artifacts.readArtifact("NonStandardERC20");
        const sellToken = await waffle.deployMockContract(deployer, abi);
        await sellToken.mock.transferFrom
          .withArgs(traders[0].address, recipient.address, amount)
          .returns();

        await expect(
          tradeExecution.transferSellAmountToRecipientTest(
            composeExecutedTrade({
              owner: traders[0].address,
              sellToken: sellToken.address,
              sellAmount: amount,
              ...withoutBuy,
            }),
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
            composeExecutedTrade({
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
});
