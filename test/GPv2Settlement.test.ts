import { ethers, waffle } from "@nomiclabs/buidler";
import IUniswapV2Factory from "@uniswap/v2-core/build/IUniswapV2Factory.json";
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

  describe("pairId", () => {
    it("should return the same ID regardless of token order", async () => {
      const [token0, token1] = [
        `0x${"42".repeat(20)}`,
        `0x${"1337".repeat(10)}`,
      ];

      expect(await settlement.pairId(token0, token1)).to.equal(
        await settlement.pairId(token1, token0),
      );
    });

    it("should revert for pairs where both tokens are equal", async () => {
      const token = `0x${"42".repeat(20)}`;
      await expect(settlement.pairId(token, token)).to.be.revertedWith(
        "invalid pair",
      );
    });
  });
});
