import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

describe("GPv2SafeERC20.sol", () => {
  const [deployer, recipient, ...traders] = waffle.provider.getWallets();

  let executor: Contract;

  beforeEach(async () => {
    const GPv2SafeERC20TestInterface = await ethers.getContractFactory(
      "GPv2SafeERC20TestInterface",
    );
    executor = await GPv2SafeERC20TestInterface.deploy();
  });

  describe("transfer", () => {
    it("succeeds when the internal call succeds", async () => {
      const amount = ethers.utils.parseEther("13.37");

      const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await sellToken.mock.transfer
        .withArgs(recipient.address, amount)
        .returns(true);

      await expect(
        executor.transfer(sellToken.address, recipient.address, amount),
      ).to.not.be.reverted;
    });

    it("reverts on failed internal call", async () => {
      const amount = ethers.utils.parseEther("4.2");

      const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await sellToken.mock.transfer
        .withArgs(recipient.address, amount)
        .revertsWithReason("test error");

      await expect(
        executor.transfer(sellToken.address, recipient.address, amount),
      ).to.be.revertedWith("test error");
    });

    describe("Non-Standard ERC20 Tokens", () => {
      it("does not revert when the internal call has no return data", async () => {
        const amount = ethers.utils.parseEther("13.37");

        const ERC20NoReturn = await artifacts.readArtifact("ERC20NoReturn");
        const sellToken = await waffle.deployMockContract(
          deployer,
          ERC20NoReturn.abi,
        );
        await sellToken.mock.transfer
          .withArgs(recipient.address, amount)
          .returns();

        await expect(
          executor.transfer(sellToken.address, recipient.address, amount),
        ).to.not.be.reverted;
      });

      it("reverts when the internal call returns false", async () => {
        const amount = ethers.utils.parseEther("4.2");

        const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
        await sellToken.mock.transfer
          .withArgs(recipient.address, amount)
          .returns(false);

        await expect(
          executor.transfer(sellToken.address, recipient.address, amount),
        ).to.be.revertedWith("failed transfer");
      });

      it("reverts when too much data is returned", async () => {
        const amount = ethers.utils.parseEther("1.0");

        const sellToken = await waffle.deployMockContract(deployer, [
          "function transfer(address, uint256) returns (bytes)",
        ]);
        await sellToken.mock.transfer
          .withArgs(recipient.address, amount)
          .returns(ethers.utils.hexlify([...Array(256)].map((_, i) => i)));

        await expect(
          executor.transfer(sellToken.address, recipient.address, amount),
        ).to.be.revertedWith("malformed transfer result");
      });

      it("coerces invalid ABI encoded bool", async () => {
        const amount = ethers.utils.parseEther("1.0");

        const sellToken = await waffle.deployMockContract(deployer, [
          "function transfer(address to, uint256 amount) external returns (uint256)",
        ]);
        await sellToken.mock.transfer
          .withArgs(recipient.address, amount)
          .returns(42);

        await expect(
          executor.transfer(sellToken.address, recipient.address, amount),
        ).to.not.be.reverted;
      });
    });

    it("does not revert when calling a non-contract", async () => {
      const amount = ethers.utils.parseEther("4.2");

      await expect(
        executor.transfer(traders[1].address, recipient.address, amount),
      ).not.to.be.reverted;
    });
  });
});
