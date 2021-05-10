import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";
import { Artifact } from "hardhat/types";

describe("GPv2SafeERC20.sol", () => {
  const [deployer, recipient, ...traders] = waffle.provider.getWallets();

  let executor: Contract;

  let ERC20NoReturn: Artifact;
  let ERC20ReturningUint: Artifact;

  beforeEach(async () => {
    const GPv2SafeERC20TestInterface = await ethers.getContractFactory(
      "GPv2SafeERC20TestInterface",
    );
    executor = await GPv2SafeERC20TestInterface.deploy();

    ERC20NoReturn = await artifacts.readArtifact("ERC20NoReturn");
    ERC20ReturningUint = await artifacts.readArtifact("ERC20ReturningUint");
  });

  describe("transfer", () => {
    it("succeeds when the internal call succeeds", async () => {
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

        const sellToken = await waffle.deployMockContract(
          deployer,
          ERC20ReturningUint.abi,
        );
        await sellToken.mock.transfer
          .withArgs(recipient.address, amount)
          .returns(42);

        await expect(
          executor.transfer(sellToken.address, recipient.address, amount),
        ).to.not.be.reverted;
      });
    });

    it("reverts when calling a non-contract", async () => {
      const amount = ethers.utils.parseEther("4.2");

      await expect(
        executor.transfer(traders[1].address, recipient.address, amount),
      ).to.be.revertedWith("not a contract");
    });
  });

  describe("transferFrom", () => {
    it("succeeds when the internal call succeeds", async () => {
      const amount = ethers.utils.parseEther("13.37");

      const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await sellToken.mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .returns(true);

      await expect(
        executor.transferFrom(
          sellToken.address,
          traders[0].address,
          recipient.address,
          amount,
        ),
      ).to.not.be.reverted;
    });

    it("reverts on failed internal call", async () => {
      const amount = ethers.utils.parseEther("4.2");

      const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
      await sellToken.mock.transferFrom
        .withArgs(traders[0].address, recipient.address, amount)
        .revertsWithReason("test error");

      await expect(
        executor.transferFrom(
          sellToken.address,
          traders[0].address,
          recipient.address,
          amount,
        ),
      ).to.be.revertedWith("test error");
    });

    describe("Non-Standard ERC20 Tokens", () => {
      it("does not revert when the internal call has no return data", async () => {
        const amount = ethers.utils.parseEther("13.37");

        const sellToken = await waffle.deployMockContract(
          deployer,
          ERC20NoReturn.abi,
        );
        await sellToken.mock.transferFrom
          .withArgs(traders[0].address, recipient.address, amount)
          .returns();

        await expect(
          executor.transferFrom(
            sellToken.address,
            traders[0].address,
            recipient.address,
            amount,
          ),
        ).to.not.be.reverted;
      });

      it("reverts when the internal call returns false", async () => {
        const amount = ethers.utils.parseEther("4.2");

        const sellToken = await waffle.deployMockContract(deployer, IERC20.abi);
        await sellToken.mock.transferFrom
          .withArgs(traders[0].address, recipient.address, amount)
          .returns(false);

        await expect(
          executor.transferFrom(
            sellToken.address,
            traders[0].address,
            recipient.address,
            amount,
          ),
        ).to.be.revertedWith("failed transferFrom");
      });

      it("reverts when too much data is returned", async () => {
        const amount = ethers.utils.parseEther("1.0");

        const sellToken = await waffle.deployMockContract(deployer, [
          "function transferFrom(address, address, uint256) returns (bytes)",
        ]);
        await sellToken.mock.transferFrom
          .withArgs(traders[0].address, recipient.address, amount)
          .returns(ethers.utils.hexlify([...Array(256)].map((_, i) => i)));

        await expect(
          executor.transferFrom(
            sellToken.address,
            traders[0].address,
            recipient.address,
            amount,
          ),
        ).to.be.revertedWith("malformed transfer result");
      });

      it("coerces invalid ABI encoded bool", async () => {
        const amount = ethers.utils.parseEther("1.0");

        const sellToken = await waffle.deployMockContract(
          deployer,
          ERC20ReturningUint.abi,
        );
        await sellToken.mock.transferFrom
          .withArgs(traders[0].address, recipient.address, amount)
          .returns(42);

        await expect(
          executor.transferFrom(
            sellToken.address,
            traders[0].address,
            recipient.address,
            amount,
          ),
        ).to.not.be.reverted;
      });
    });

    it("reverts when calling a non-contract", async () => {
      const amount = ethers.utils.parseEther("4.2");

      await expect(
        executor.transferFrom(
          traders[1].address,
          traders[0].address,
          recipient.address,
          amount,
        ),
      ).to.be.revertedWith("not a contract");
    });
  });
});
