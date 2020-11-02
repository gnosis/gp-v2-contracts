import { ethers, waffle } from "@nomiclabs/buidler";
import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import IUniswapV2Factory from "@uniswap/v2-core/build/IUniswapV2Factory.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import { expect } from "chai";
import { Contract, BigNumber } from "ethers";

import {
  REPLAYABLE_NONCE,
  OrderKind,
  encodeExecutedOrder,
  encodeExecutedOrderFlags,
} from "../src/ts";

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

  describe("nonces", () => {
    it("should be initialized to zero", async () => {
      expect(await settlement.nonces(`0x${"42".repeat(20)}`)).to.equal(
        ethers.constants.Zero,
      );
    });
  });

  describe("fetchIncrementNonce", () => {
    const pair = `0x${"42".repeat(20)}`;

    it("should increment pair nonce by one", async () => {
      await settlement.setNonce(pair, 1336);
      await settlement.fetchIncrementNonceTest(pair);
      expect(await settlement.nonces(pair)).to.equal(BigNumber.from(1337));
    });

    it("should start with nonce 1", async () => {
      expect(
        await settlement.callStatic.fetchIncrementNonceTest(pair),
      ).to.equal(ethers.constants.One);
    });

    it("should return the value after incrementing", async () => {
      await settlement.setNonce(pair, 41);
      expect(
        await settlement.callStatic.fetchIncrementNonceTest(pair),
      ).to.equal(BigNumber.from(42));
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

  describe("decodeOrder", () => {
    const fillBytes = (bytes: number, marker: number) =>
      `0x${[...Array(bytes)]
        .map((_, i) =>
          (i + (marker << 4)).toString(16).padStart(2, "0").substr(0, 2),
        )
        .join("")}`;
    const fillUint = (bits: number, marker: number) =>
      BigNumber.from(fillBytes(bits / 8, marker));

    const order = {
      sellToken: `0x${"5311".repeat(10)}`,
      buyToken: `0x${"b111".repeat(10)}`,
      sellAmount: fillUint(112, 1),
      buyAmount: fillUint(112, 2),
      validTo: fillUint(32, 3).toNumber(),
      nonce: fillUint(32, 4).toNumber(),
      tip: fillUint(112, 5),
      flags: {
        kind: OrderKind.BUY,
        partiallyFillable: true,
      },
    };
    const executedAmount = fillUint(112, 6);
    const signature = ethers.utils.splitSignature(`${fillBytes(64, 0)}01`);

    it("should round-trip encode executed order data", async () => {
      const encodedOrder = encodeExecutedOrder(
        order,
        executedAmount,
        signature,
      );

      expect(await settlement.decodeOrderTest(encodedOrder)).to.deep.equal([
        order.sellAmount,
        order.buyAmount,
        order.validTo,
        order.tip,
        encodeExecutedOrderFlags(order),
        executedAmount,
        signature.v,
        signature.r,
        signature.s,
      ]);
    });

    it("should encode replayable orders", async () => {
      const encodedOrder = encodeExecutedOrder(
        { ...order, nonce: REPLAYABLE_NONCE },
        executedAmount,
        signature,
      );
      const decodedOrder = await settlement.decodeOrderTest(encodedOrder);

      // NOTE: The expected bit-flag value here is:
      // bit | 7 | 6-2 | 1 | 0
      // ----------------------
      // val | 1 |  0  | 1 | 1
      //       ^         ^   ^
      //       +---------+---+-- replayable order (nonce = 0)
      //                 +---+-- partially fillable
      //                     +-- buy order
      expect(decodedOrder[4]).to.equal(0x83);
    });

    it("should not allocate memory", async () => {
      // NOTE: We want to make sure that calls to `decodeOrder` does not require
      // additional memory allocations to save on memory per orders.
      const encodedOrder = encodeExecutedOrder(
        order,
        executedAmount,
        signature,
      );

      expect(
        await settlement.decodeOrderMemoryTest(encodedOrder),
      ).to.deep.equal(ethers.constants.Zero);
    });
  });
});
