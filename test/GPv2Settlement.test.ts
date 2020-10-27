import { ethers, waffle } from "@nomiclabs/buidler";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import IUniswapV2Factory from "@uniswap/v2-core/build/IUniswapV2Factory.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import { expect, assert } from "chai";
import { BigNumber, Contract } from "ethers";

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

  describe("uniswapTrade", () => {
    async function tradeWithAddressOrder(
      ordering: (left: string, right: string) => boolean,
    ) {
      uniswapFactory = await waffle.deployContract(deployer, UniswapV2Factory, [
        deployer.address,
      ]);
      const tokenA = await waffle.deployContract(deployer, ERC20, [
        "tokenA",
        "18",
      ]);
      const tokenB = await waffle.deployContract(deployer, ERC20, [
        "tokenB",
        "18",
      ]);
      // tokenIn and tokenOut are sorted according to the chosen ordering
      const [tokenIn, tokenOut] = ordering(tokenA.address, tokenB.address)
        ? [tokenA, tokenB]
        : [tokenB, tokenA];

      await uniswapFactory.createPair(tokenA.address, tokenB.address, {
        gasLimit: 6000000,
      });
      const pairAddress = await uniswapFactory.getPair(
        tokenA.address,
        tokenB.address,
      );
      let pair = await waffle.deployContract(deployer, UniswapV2Pair);
      pair = await pair.attach(pairAddress);

      // Uniswap pool has a price of one
      const poolIn = BigNumber.from(10).pow(21);
      const poolOut = BigNumber.from(10).pow(21);
      await tokenIn.mint(pair.address, poolIn);
      await tokenOut.mint(pair.address, poolOut);
      // store deposits in Uniswap's reserves
      await pair.mint(deployer.address);

      const amountIn = BigNumber.from(10).pow(18);
      const maxAmountOut = poolOut
        .mul(amountIn)
        .mul(997)
        .div(1000)
        .div(poolIn.add(amountIn.mul(997).div(1000).add(1)));
      assert(maxAmountOut.gt(0));

      const GPv2SettlementTestInterface = await ethers.getContractFactory(
        "GPv2SettlementTestInterface",
      );
      const settlementTester = await GPv2SettlementTestInterface.deploy(
        uniswapFactory.address,
      );
      await tokenIn.mint(settlementTester.address, amountIn);

      // extra amount that should not be affected by the settlement
      const untouchedAmountTokenIn = BigNumber.from(10).pow(19);
      await tokenIn.mint(settlementTester.address, untouchedAmountTokenIn);

      await expect(
        settlementTester.uniswapTradeTest(
          tokenIn.address,
          tokenOut.address,
          amountIn,
          maxAmountOut,
          { gasLimit: 6000000 },
        ),
      ).not.to.be.reverted;

      expect(await tokenOut.balanceOf(settlementTester.address)).to.be.equal(
        maxAmountOut,
      );
      expect(await tokenIn.balanceOf(settlementTester.address)).to.be.equal(
        untouchedAmountTokenIn,
      );
    }

    it("swaps when the sold token is Uniswap's token0", async () => {
      await tradeWithAddressOrder((left, right) => left < right);
    });

    it("swaps when the sold token is Uniswap's token1", async () => {
      await tradeWithAddressOrder((left, right) => left > right);
    });
  });
});
