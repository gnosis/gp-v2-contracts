import { ethers, waffle } from "@nomiclabs/buidler";
import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import IUniswapV2Factory from "@uniswap/v2-core/build/IUniswapV2Factory.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import { expect } from "chai";
import { Contract } from "ethers";

describe("GPv2Settlement", () => {
  const [deployer] = waffle.provider.getWallets();

  let settlement: Contract;
  let uniswapFactory: Contract;

  beforeEach(async () => {
    const GPv2Settlement = await ethers.getContractFactory(
      "GPv2SettlementTestInterface",
    );

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

  describe("verifyClearingPrice", () => {
    let uniswapPair: Contract;

    beforeEach(async () => {
      uniswapPair = await waffle.deployMockContract(
        deployer,
        IUniswapV2Pair.abi,
      );
    });

    it("should allow clearing prices within Uniswap spot price range", async () => {
      await uniswapPair.mock.getReserves.returns(1e6, 2e8, 0);
      for (const [clearingPrice0, clearingPrice1] of [
        [1000, 200000],
        [997, 199800], // NOTE: Minimum price
        [999, 199400], // NOTE: Maximum price
      ]) {
        await expect(
          settlement.verifyClearingPriceTest(
            uniswapPair.address,
            0,
            0,
            clearingPrice0,
            clearingPrice1,
          ),
        ).to.not.be.reverted;
      }
    });

    it("should revert if clearing price is outside of Unswap spot price range", async () => {
      await uniswapPair.mock.getReserves.returns(1e6, 2e8, 0);
      await expect(
        settlement.verifyClearingPriceTest(
          uniswapPair.address,
          0,
          0,
          10021,
          2000000,
        ),
      ).to.be.revertedWith("Uniswap price not respected");
      await expect(
        settlement.verifyClearingPriceTest(
          uniswapPair.address,
          0,
          0,
          9999,
          2004000,
        ),
      ).to.be.revertedWith("Uniswap price not respected");
    });

    it("should allow clearing prices within Uniswap effective token 0 buy price range", async () => {
      // NOTE: If `d0` is negative, then we are removing token 0 from the
      // Uniswap reserves, i.e. we are buying token 0 for token 1. Conversely,
      // if `d1` is negative, then we are buying token 1 for token 0.
      for (const [clearingPrice0, clearingPrice1] of [
        [1000, 199800], // NOTE: Minimum price
        [9990, 1988018], // NOTE: Maximum price
      ]) {
        await expect(
          settlement.verifyClearingPriceTest(
            uniswapPair.address,
            -1,
            200,
            clearingPrice0,
            clearingPrice1,
          ),
        ).to.not.be.reverted;
      }
    });

    it("should allow clearing prices within Uniswap effective token 1 buy price range", async () => {
      for (const [clearingPrice0, clearingPrice1] of [
        [994009, 199800000], // NOTE: Minimum price
        [999, 200000], // NOTE: Maximum price
      ]) {
        await expect(
          settlement.verifyClearingPriceTest(
            uniswapPair.address,
            1,
            -200,
            clearingPrice0,
            clearingPrice1,
          ),
        ).to.not.be.reverted;
      }
    });

    it("should revert if clearing price is outside of Uniswap effective price range", async () => {
      for (const [d0, d1, clearingPrice0, clearingPrice1] of [
        [-1, 200, 999, 199800],
        [-1, 200, 9991, 1988018],
        [1, -200, 994008, 199800000],
        [1, -200, 1000, 200000],
      ]) {
        await expect(
          settlement.verifyClearingPriceTest(
            uniswapPair.address,
            d0,
            d1,
            clearingPrice0,
            clearingPrice1,
          ),
        ).to.be.revertedWith("Uniswap price not respected");
      }
    });

    it("should revert for invalid Uniswap swap amounts", async () => {
      for (const [d0, d1] of [
        [1, 0],
        [0, 1],
        [-1, -1],
        [1, 1],
      ]) {
        await expect(
          settlement.verifyClearingPriceTest(uniswapPair.address, d0, d1, 1, 1),
        ).to.be.revertedWith("invalid Uniswap amounts");
      }
    });
  });
});
