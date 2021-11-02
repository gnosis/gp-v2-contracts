import { expect } from "chai";

import { BlockNativeGasEstimator } from "../../../src/tasks/ts/gas";

// We allow failure for BlockNative tests because their service may be down, and
// we don't want to block CI because of it.
//
// The tests in this file still provide an indication that things are working
// and should pass most of the time.
function itAllowFail(title: string, callback: () => Promise<void>) {
  it(title, async function () {
    try {
      await callback();
    } catch (err) {
      console.warn(`allowed failure: ${err}`);
      this.skip();
    }
  });
}

describe("Task helper: BlockNative gas estimator", () => {
  const blockNative = new BlockNativeGasEstimator();

  itAllowFail("estimates gas", async () => {
    const gasPrice = await blockNative.gasPriceEstimate();

    expect(gasPrice.gt(0)).to.be.true;
  });

  itAllowFail("computes transaction gas prices", async () => {
    const { gasPrice, maxFeePerGas, maxPriorityFeePerGas } =
      await blockNative.txGasPrice();

    expect(gasPrice).to.be.undefined;

    expect(maxFeePerGas).to.not.be.undefined;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(maxFeePerGas!.gt(0)).to.be.true;

    expect(maxPriorityFeePerGas).to.not.be.undefined;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(maxPriorityFeePerGas!.gt(0)).to.be.true;
  });
});
