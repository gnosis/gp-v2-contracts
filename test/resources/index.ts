import { debug } from "debug";
import { BigNumber } from "ethers";
import _ from "lodash";

import { Fraction, TestCaseInput, Solution, TestCase } from "./models";

const log = debug("index.ts");
export const solveTestCase = function (testCaseInput: TestCaseInput): Solution {
  let sumSellDemandToken0 = BigNumber.from(0);
  testCaseInput.sellOrdersToken0.forEach((order) => {
    sumSellDemandToken0 = sumSellDemandToken0.add(order.sellAmount);
  });

  let sumSellAmountToken1 = BigNumber.from(0);
  testCaseInput.sellOrdersToken1.forEach((order) => {
    sumSellAmountToken1 = sumSellAmountToken1.add(order.sellAmount);
  });
  if (sumSellDemandToken0.isZero() || sumSellAmountToken1.isZero()) {
    log("no solution found");
    return {
      clearingPrice: {
        numerator: BigNumber.from("0"),
        denominator: BigNumber.from("0"),
      },
      sellOrdersToken0: [],
      sellOrdersToken1: [],
    };
  }
  const highestSellOrderToken0 =
    testCaseInput.sellOrdersToken0[testCaseInput.sellOrdersToken0.length - 1];
  const highestSellOrderToken1 =
    testCaseInput.sellOrdersToken1[testCaseInput.sellOrdersToken1.length - 1];
  // We will always assume that we have a unsettlable amount in token0. If not, we change order of
  log("Total selling demand token0", sumSellDemandToken0.toString());
  log("Total selling demand token1", sumSellAmountToken1.toString());
  log(
    "Highest bid selling OrderToken0",
    highestSellOrderToken0.sellAmount.toString(),
  );
  log(
    "Highest bid selling OrderToken1",
    highestSellOrderToken0.buyAmount.toString(),
  );
  if (
    sumSellDemandToken0
      .mul(highestSellOrderToken1.sellAmount)
      .lt(sumSellAmountToken1.mul(highestSellOrderToken1.buyAmount))
  ) {
    log("switching token0 and token1");

    return solveTestCase({
      fundingAMMToken0: testCaseInput.fundingAMMToken1,
      fundingAMMToken1: testCaseInput.fundingAMMToken0,
      sellOrdersToken0: testCaseInput.sellOrdersToken1,
      sellOrdersToken1: testCaseInput.sellOrdersToken0,
    });
  }
  const clearingPrice: Fraction = {
    numerator: sumSellDemandToken0.add(testCaseInput.fundingAMMToken0),
    denominator: sumSellAmountToken1.add(testCaseInput.fundingAMMToken1),
  };
  log(
    "new clearing price",
    clearingPrice.denominator.toString(),
    "/",
    clearingPrice.numerator.toString(),
    "=",
    clearingPrice.denominator
      .mul(1000)
      .div(clearingPrice.numerator)
      .toNumber() / 1000,
  );
  if (
    highestSellOrderToken0.sellAmount
      .mul(clearingPrice.denominator)
      .lt(highestSellOrderToken0.buyAmount.mul(clearingPrice.numerator))
  ) {
    // In this case the clearing price of the order selling token0 with the highest price is violated.
    // We remove this bid and try to solve again

    // Actually, the bid's sellAmount could also just be reduced, if uniswap prices(reserve0/reserve1)
    // is smaller than bid-price. We leave this optimzation for later and go with the principle fill or kill
    log(`popping sellOrdersToken0, due to a its limit price of
     ${highestSellOrderToken0.sellAmount} / ${highestSellOrderToken0.buyAmount}`);
    testCaseInput.sellOrdersToken0.pop();
    return solveTestCase({
      fundingAMMToken0: testCaseInput.fundingAMMToken0,
      fundingAMMToken1: testCaseInput.fundingAMMToken1,
      sellOrdersToken0: testCaseInput.sellOrdersToken0,
      sellOrdersToken1: testCaseInput.sellOrdersToken1,
    });
  } else if (
    clearingPrice.numerator
      .mul(highestSellOrderToken1.sellAmount)
      .lt(clearingPrice.denominator.mul(highestSellOrderToken1.buyAmount))
  ) {
    // In this case the clearing price of the order selling token1 with the highest price is violated.
    // We remove this bid and try to solve again
    log(`popping sellOrdersToken1, due to a its limit price of
     ${highestSellOrderToken1.buyAmount} / ${highestSellOrderToken1.sellAmount}`);
    testCaseInput.sellOrdersToken1.pop();
    return solveTestCase({
      fundingAMMToken0: testCaseInput.fundingAMMToken0,
      fundingAMMToken1: testCaseInput.fundingAMMToken1,
      sellOrdersToken0: testCaseInput.sellOrdersToken0,
      sellOrdersToken1: testCaseInput.sellOrdersToken1,
    });
  }
  const unmatchedAmount = sumSellDemandToken0.sub(
    sumSellAmountToken1
      .mul(clearingPrice.numerator)
      .div(clearingPrice.denominator),
  );
  log("unmatchedAmount", unmatchedAmount.toString());
  // No price violation, we found a solution:
  return {
    clearingPrice: clearingPrice,
    sellOrdersToken0: testCaseInput.sellOrdersToken0,
    sellOrdersToken1: testCaseInput.sellOrdersToken1,
  };
};

export const generateTestCase = function (
  testCaseInput: TestCaseInput,
): TestCase {
  return new TestCase(
    testCaseInput.fundingAMMToken0,
    testCaseInput.fundingAMMToken1,
    _.cloneDeep(testCaseInput.sellOrdersToken0), // <-- deep copy needed as solveTestCase can modify the orders
    _.cloneDeep(testCaseInput.sellOrdersToken1),
    solveTestCase(testCaseInput),
  );
};

export const SoliditySqrt = function (y: BigNumber): BigNumber {
  let z = BigNumber.from(0);
  if (y.gt(3)) {
    z = y;
    let x = y.div(2).add(1);
    while (x.lt(z)) {
      z = x;
      x = y.div(x).add(x).div(2);
    }
  } else if (!y.isZero()) {
    z = BigNumber.from(1);
  }
  return z;
};
