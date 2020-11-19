import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { Contract, BigNumberish } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

interface Transfer {
  owner: string;
  token: string;
  amount: BigNumberish;
}

function composeTransfers(
  transfers: Transfer[],
): [string, string, BigNumberish][] {
  return transfers.map(({ owner, token, amount }) => [owner, token, amount]);
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
    it("should revert if not called by the owner", async () => {
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
              token: tokens[0].address,
              amount,
            },
            {
              owner: traders[1].address,
              token: tokens[1].address,
              amount,
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
              token: token.address,
              amount,
            },
          ]),
        ),
      ).to.be.revertedWith("test error");
    });

    it("should revert on failed non-standard ERC20 transfers", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);

      const amount = ethers.utils.parseEther("4.2");
      await token.mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .returns(false);

      await expect(
        allowanceManager.transferIn(
          composeTransfers([
            {
              owner: traders[0].address,
              token: token.address,
              amount,
            },
          ]),
        ),
      ).to.be.revertedWith("ERC20 operation did not succeed");
    });

    it("should revert when transfering from an address without code", async () => {
      await expect(
        allowanceManager.transferIn(
          composeTransfers([
            {
              owner: traders[0].address,
              token: traders[1].address,
              amount: ethers.constants.WeiPerEther,
            },
          ]),
        ),
      ).to.be.revertedWith("call to non-contract");
    });
  });
});
