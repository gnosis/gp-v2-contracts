import { Contract, Wallet, utils } from "ethers";

import { Order } from "../../src/js/orders.spec";

import { TestCaseInput } from "./models";

export const baseTestInput = function (
  token0: Contract,
  token1: Contract,
  tradersToken0: Wallet[],
  tradersToken1: Wallet[],
): TestCaseInput {
  return {
    fundingAMMToken0: utils.parseEther("10"),
    fundingAMMToken1: utils.parseEther("10"),
    sellOrdersToken0: [
      new Order(
        utils.parseEther("1"),
        utils.parseEther("0.9"),
        token0,
        token1,
        tradersToken0[0],
        1,
      ),
    ],
    sellOrdersToken1: [
      new Order(
        utils.parseEther("0.9"),
        utils.parseEther("0.90111"),
        token1,
        token0,
        tradersToken1[0],
        1,
      ),
    ],
  };
};

export const fourOrderTestInput = function (
  token0: Contract,
  token1: Contract,
  tradersToken0: Wallet[],
  tradersToken1: Wallet[],
): TestCaseInput {
  return {
    fundingAMMToken0: utils.parseEther("10"),
    fundingAMMToken1: utils.parseEther("10"),
    sellOrdersToken0: [
      new Order(
        utils.parseEther("1"),
        utils.parseEther("0.9"),
        token0,
        token1,
        tradersToken0[0],
        1,
      ),
      new Order(
        utils.parseEther("0.5"),
        utils.parseEther("0.45"),
        token0,
        token1,
        tradersToken0[1],
        2,
      ),
    ],
    sellOrdersToken1: [
      new Order(
        utils.parseEther("0.9"),
        utils.parseEther("0.90111"),
        token1,
        token0,
        tradersToken1[0],
        1,
      ),
      new Order(
        utils.parseEther("0.45"),
        utils.parseEther("0.45"),
        token1,
        token0,
        tradersToken1[1],
        1,
      ),
    ],
  };
};

export const oneOrderSellingToken0IsOmittedTestInput = function (
  token0: Contract,
  token1: Contract,
  tradersToken0: Wallet[],
  tradersToken1: Wallet[],
): TestCaseInput {
  return {
    fundingAMMToken0: utils.parseEther("10"),
    fundingAMMToken1: utils.parseEther("10"),
    sellOrdersToken0: [
      new Order(
        utils.parseEther("10.1"),
        utils.parseEther("9.7"),
        token0,
        token1,
        tradersToken0[0],
        1,
      ),
      new Order(
        utils.parseEther("5"), // <--- this order would can not be traded fully against uniswap
        utils.parseEther("4.91"),
        token0,
        token1,
        tradersToken0[1],
        2,
      ),
    ],
    sellOrdersToken1: [
      new Order(
        utils.parseEther("10"),
        utils.parseEther("9"),
        token1,
        token0,
        tradersToken1[0],
        1,
      ),
    ],
  };
};

export const noSolutionTestInput = function (
  token0: Contract,
  token1: Contract,
  tradersToken0: Wallet[],
  tradersToken1: Wallet[],
): TestCaseInput {
  return {
    fundingAMMToken0: utils.parseEther("10"),
    fundingAMMToken1: utils.parseEther("10"),
    sellOrdersToken0: [
      new Order(
        utils.parseEther("10"),
        utils.parseEther("9.7"),
        token0,
        token1,
        tradersToken0[0],
        1,
      ),
      new Order(
        utils.parseEther("5"),
        utils.parseEther("4.9"),
        token0,
        token1,
        tradersToken0[1],
        2,
      ),
    ],
    sellOrdersToken1: [
      new Order(
        utils.parseEther("3"),
        utils.parseEther("2"),
        token1,
        token0,
        tradersToken1[0],
        1,
      ),
      new Order(
        utils.parseEther("3"),
        utils.parseEther("2.5"),
        token1,
        token0,
        tradersToken1[1],
        2,
      ),
      new Order(
        utils.parseEther("3"),
        utils.parseEther("2.6"),
        token1,
        token0,
        tradersToken1[2],
        3,
      ),
    ],
  };
};

export const oneOrderSellingToken1IsOmittedTestInput = function (
  token0: Contract,
  token1: Contract,
  tradersToken0: Wallet[],
  tradersToken1: Wallet[],
): TestCaseInput {
  return {
    fundingAMMToken0: utils.parseEther("10"),
    fundingAMMToken1: utils.parseEther("10"),

    sellOrdersToken0: [
      new Order(
        utils.parseEther("10"),
        utils.parseEther("9"),
        token1,
        token0,
        tradersToken0[0],
        1,
      ),
      new Order(
        utils.parseEther("3"),
        utils.parseEther("2.5"),
        token1,
        token0,
        tradersToken0[1],
        2,
      ),
      new Order(
        utils.parseEther("3"),
        utils.parseEther("2.5"),
        token1,
        token0,
        tradersToken0[2],
        3,
      ),
      new Order(
        utils.parseEther("3"), // <--- this order would can not be traded fully against uniswap
        utils.parseEther("2.99"),
        token1,
        token0,
        tradersToken0[3],
        4,
      ),
    ],
    sellOrdersToken1: [
      new Order(
        utils.parseEther("10"),
        utils.parseEther("9.7"),
        token0,
        token1,
        tradersToken1[0],
        1,
      ),
      new Order(
        utils.parseEther("5"),
        utils.parseEther("4.9"),
        token0,
        token1,
        tradersToken1[1],
        2,
      ),
    ],
  };
};

export const switchTokenTestInput = function (
  token0: Contract,
  token1: Contract,
  tradersToken0: Wallet[],
  tradersToken1: Wallet[],
): TestCaseInput {
  return {
    fundingAMMToken0: utils.parseEther("10"),
    fundingAMMToken1: utils.parseEther("10"),
    sellOrdersToken0: [
      new Order(
        utils.parseEther("10"),
        utils.parseEther("9.7"),
        token0,
        token1,
        tradersToken0[0],
        1,
      ),
      new Order(
        utils.parseEther("5"),
        utils.parseEther("4.9"),
        token0,
        token1,
        tradersToken0[1],
        2,
      ),
    ],
    sellOrdersToken1: [
      new Order(
        utils.parseEther("10"),
        utils.parseEther("9"),
        token1,
        token0,
        tradersToken1[0],
        1,
      ),
      new Order(
        utils.parseEther("3"),
        utils.parseEther("2.5"),
        token1,
        token0,
        tradersToken1[1],
        2,
      ),
      new Order(
        utils.parseEther("3"),
        utils.parseEther("2.6"),
        token1,
        token0,
        tradersToken1[2],
        3,
      ),
      new Order(
        utils.parseEther("3"),
        utils.parseEther("2.9"),
        token1,
        token0,
        tradersToken1[3],
        4,
      ),
    ],
  };
};
