import { BigNumber } from "ethers";

import { Order } from "../../src/js/orders.spec";

export declare type Fraction = {
  numerator: BigNumber;
  denominator: BigNumber;
};

export declare type Solution = {
  clearingPrice: Fraction;
  sellOrdersToken0: Order[];
  sellOrdersToken1: Order[];
};

export class TestCase {
  fundingAMMToken0: BigNumber;
  fundingAMMToken1: BigNumber;
  sellOrdersToken0: Order[];
  sellOrdersToken1: Order[];
  solution: Solution;

  constructor(
    fundingAMMToken0: BigNumber | number,
    fundingAMMToken1: BigNumber | number,
    sellOrdersToken0: Order[],
    sellOrdersToken1: Order[],
    solution: Solution,
  ) {
    this.fundingAMMToken0 = BigNumber.from(fundingAMMToken0);
    this.fundingAMMToken1 = BigNumber.from(fundingAMMToken1);
    this.sellOrdersToken0 = sellOrdersToken0;
    this.sellOrdersToken1 = sellOrdersToken1;
    this.solution = solution;
  }

  getAllOrders(): Order[] {
    return this.sellOrdersToken0.concat(this.sellOrdersToken1);
  }

  getSellOrdersToken0Encoded(): Buffer {
    return Buffer.concat(this.sellOrdersToken0.map((order) => order.encode()));
  }

  getSellOrdersToken1Encoded(): Buffer {
    return Buffer.concat(this.sellOrdersToken1.map((order) => order.encode()));
  }
}

export declare type TestCaseInput = {
  fundingAMMToken0: BigNumber;
  fundingAMMToken1: BigNumber;
  sellOrdersToken0: Order[];
  sellOrdersToken1: Order[];
};
