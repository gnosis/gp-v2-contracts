import { ethers, waffle } from "@nomiclabs/buidler";
import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import IUniswapV2Factory from "@uniswap/v2-core/build/IUniswapV2Factory.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import { expect } from "chai";
import { Contract } from "ethers";

describe("GPv2Settlement", () => {
  const [deployer] = waffle.provider.getWallets();

  let settlement: Contract;
  let uniswapFactory: Contract;

  beforeEach(async () => {
    const GPv2Settlement = await ethers.getContractFactory("GPv2Settlement");

    uniswapFactory = await waffle.deployMockContract(
      deployer,
      IUniswapV2Factory.abi,
    );
    settlement = await GPv2Settlement.deploy(uniswapFactory.address);
  });

  describe("replayProtection", () => {
    it("should have a well defined replay protection signature mixer", async () => {
      const { chainId } = await waffle.provider.getNetwork();
      expect(chainId).to.not.equal(ethers.constants.Zero);

      expect(await settlement.replayProtection()).to.equal(
        ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ["string", "uint256", "address"],
            ["GPv2", chainId, settlement.address],
          ),
        ),
      );
    });

    it("should have a different replay protection for each deployment", async () => {
      const GPv2Settlement = await ethers.getContractFactory("GPv2Settlement");
      const settlement2 = await GPv2Settlement.deploy(uniswapFactory.address);

      expect(await settlement.replayProtection()).to.not.equal(
        await settlement2.replayProtection(),
      );
    });
  });

  describe("uniswapFactory", () => {
    it("should be set by the constructor", async () => {
      expect(await settlement.uniswapFactory()).to.equal(
        uniswapFactory.address,
      );
    });
  });

  describe("nonce", () => {
    it("should should be initialized to zero", async () => {
      expect(await settlement.nonce(`0x${"42".repeat(20)}`)).to.equal(
        ethers.constants.Zero,
      );
    });
  });

  describe("uniswapPairAddress", () => {
    it("should match the on-chain Uniswap pair address", async () => {
      // TODO(nlordell): This should move to be an integration test once they
      // have been setup.

      const tokenA = await waffle.deployMockContract(deployer, IERC20.abi);
      const tokenB = await waffle.deployMockContract(deployer, IERC20.abi);
      const [token0, token1] =
        tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];

      const GPv2Settlement = await ethers.getContractFactory("GPv2Settlement");
      for (const [tokenX, tokenY] of [
        [token0, token1],
        [token1, token0],
      ]) {
        const uniswapFactory = await waffle.deployContract(
          deployer,
          UniswapV2Factory,
          [deployer.address],
        );

        await uniswapFactory.createPair(tokenX.address, tokenY.address);
        const uniswapPairAddress = await uniswapFactory.getPair(
          tokenX.address,
          tokenY.address,
        );

        const settlement = await GPv2Settlement.deploy(uniswapFactory.address);

        expect(
          await settlement.uniswapPairAddress(token0.address, token1.address),
        ).to.equal(uniswapPairAddress);
      }
    });

    it("should revert if token order is inverted", async () => {
      const [token0, token1] = [
        `0x${"00".repeat(19)}0a`,
        `0x${"00".repeat(19)}0b`,
      ];

      await expect(
        settlement.uniswapPairAddress(token1, token0),
      ).to.be.revertedWith("invalid pair");
    });

    it("should revert for pairs where both tokens are equal", async () => {
      const token = `0x${"42".repeat(20)}`;

      await expect(
        settlement.uniswapPairAddress(token, token),
      ).to.be.revertedWith("invalid pair");
    });

    it("should revert for pairs where either token is address 0", async () => {
      const token = `0x${"42".repeat(20)}`;

      await expect(
        settlement.uniswapPairAddress(token, ethers.constants.AddressZero),
      ).to.be.revertedWith("invalid pair");
      await expect(
        settlement.uniswapPairAddress(ethers.constants.AddressZero, token),
      ).to.be.revertedWith("invalid pair");
    });
  });
});
