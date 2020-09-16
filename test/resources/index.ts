import {Fraction, TestCaseInput, TestCase} from './models';
import {BigNumber, Contract, Wallet, utils} from 'ethers';
import {Order} from '../../src/js/orders.spec';

export const baseTestInput = function (token0: Contract, token1: Contract, tradersToken0: Wallet[],
  tradersToken1: Wallet[]):
  TestCaseInput {
  return {
    fundingAMMToken0: utils.parseEther('10'),
    fundingAMMToken1: utils.parseEther('10'),
    sellOrdersToken0: [new Order(utils.parseEther('1'),
      utils.parseEther('0.9'), token0, token1, tradersToken0[0], 1)],
    sellOrdersToken1: [new Order(utils.parseEther('0.9'),
      utils.parseEther('0.90111'), token1, token0, tradersToken1[0], 1)]
  };
};

export const fourOrderTestInput = function (token0: Contract, token1: Contract, tradersToken0: Wallet[],
  tradersToken1: Wallet[]):
  TestCaseInput {
  return {
    fundingAMMToken0: utils.parseEther('10'),
    fundingAMMToken1: utils.parseEther('10'),
    sellOrdersToken0: [new Order(utils.parseEther('1'),
      utils.parseEther('0.9'), token0, token1, tradersToken0[0], 1),
    new Order(utils.parseEther('0.5'),
      utils.parseEther('0.45'), token0, token1, tradersToken0[1], 2)],
    sellOrdersToken1: [new Order(utils.parseEther('0.9'),
      utils.parseEther('0.90111'), token1, token0, tradersToken1[0], 1),
    new Order(utils.parseEther('0.45'),
      utils.parseEther('0.45'), token1, token0, tradersToken1[1], 1)]
  };
};

export const generateTestCase = function (testCaseInput: TestCaseInput): TestCase {
  let sumSellDemandToken0 = BigNumber.from(0);
  testCaseInput.sellOrdersToken0.forEach(order => {
    sumSellDemandToken0 = sumSellDemandToken0.add(order.sellAmount);
  });

  let sumSellAmountToken1 = BigNumber.from(0);
  testCaseInput.sellOrdersToken1.forEach(order => {
    sumSellAmountToken1 = sumSellAmountToken1.add(order.sellAmount);
  });

  const uniswapK = testCaseInput.fundingAMMToken0.mul(testCaseInput.fundingAMMToken1);
  const p = uniswapK.div(
    BigNumber.from(2).mul(testCaseInput.fundingAMMToken1.add(sumSellAmountToken1))
  );

  const newFundingAMMToken0 = p.add(
    SoliditySqrt(
      p.mul(p).add(
        uniswapK.mul(sumSellDemandToken0).div(
          testCaseInput.fundingAMMToken1.add(sumSellAmountToken1)
        )
      )
    )
  );

  const newFundingAMMToken1 = uniswapK.div(newFundingAMMToken0);
  const clearingPrice: Fraction = {
    numerator: newFundingAMMToken0,
    denominator: newFundingAMMToken1
  };
  const settledAmountsSellOrderToken0 = testCaseInput.sellOrdersToken0.map(order => order.sellAmount);
  const settledAmountsSellOrderToken1 = testCaseInput.sellOrdersToken1.map(order => order.sellAmount);
  return new TestCase(
    testCaseInput.fundingAMMToken0, testCaseInput.fundingAMMToken1, testCaseInput.sellOrdersToken0,
    testCaseInput.sellOrdersToken1, {clearingPrice: clearingPrice,
      settledAmountsSellOrderToken0: settledAmountsSellOrderToken0,
      settledAmountsSellOrderToken1: settledAmountsSellOrderToken1}
  );
};

export const SoliditySqrt = function (y: BigNumber): BigNumber {
  let z = BigNumber.from(0);
  if (y.gt(3)) {
    z = y;
    let x = y.div(2).add(1);
    while (x.lt(z)) {
      z = x;
      x = (y.div(x).add(x)).div(2);
    }
  } else if (!y.isZero()) {
    z = BigNumber.from(1);
  }
  return z;
};
