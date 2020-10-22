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

  describe("DOMAIN_SEPARATOR", () => {
    it("should have a well defined domain separator", async () => {
      expect(await settlement.DOMAIN_SEPARATOR()).to.equal(
        ethers.utils.id("GPv2"),
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
      expect(await settlement.nonce()).to.equal(ethers.constants.Zero);
    });
  });
});
