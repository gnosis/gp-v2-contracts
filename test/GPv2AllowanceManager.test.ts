import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import { ExecutedTrade, composeExecutedTrade } from "./GPv2TradeExecution.test";

type InTransfer = Pick<ExecutedTrade, "owner" | "sellToken" | "sellAmount">;

function composeTransfers(
  trades: InTransfer[],
): ReturnType<typeof composeExecutedTrade>[] {
  return trades.map((partialTrade) =>
    composeExecutedTrade({
      ...partialTrade,
      buyToken: ethers.constants.AddressZero,
      buyAmount: ethers.constants.Zero,
    }),
  );
}

describe("GPv2AllowanceManager", () => {
  const [
    deployer,
    recipient,
    nonRecipient,
    ...traders
  ] = waffle.provider.getWallets();

  let allowanceManager: Contract;

  beforeEach(async () => {
    const GPv2AllowanceManager = await ethers.getContractFactory(
      "GPv2AllowanceManager",
      recipient,
    );

    allowanceManager = await GPv2AllowanceManager.deploy();
  });

  describe("transferIn", () => {
    it("should revert if not called by the recipient", async () => {
      await expect(
        allowanceManager.connect(nonRecipient).transferIn([]),
      ).to.be.revertedWith("not allowance recipient");
    });

    it("should execute ERC20 transfers", async () => {
      const NonStandardERC20 = await artifacts.readArtifact("NonStandardERC20");
      const tokens = [
        await waffle.deployMockContract(deployer, IERC20.abi),
        await waffle.deployMockContract(deployer, NonStandardERC20.abi),
      ];

      const amount = ethers.utils.parseEther("13.37");
      await tokens[0].mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .returns(true);
      await tokens[1].mock.transferFrom
        .withArgs(traders[1].address, recipient.address, amount)
        .returns();

      await expect(
        allowanceManager.transferIn(
          composeTransfers([
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
        .withArgs(traders[0].address, recipient.address, amount)
        .revertsWithReason("test error");

      await expect(
        allowanceManager.transferIn(
          composeTransfers([
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
