import chalk from "chalk";

import { BenchFixture } from "./fixture";

async function main() {
  const fixture = await BenchFixture.create();

  const pad = (x: unknown) => ` ${x} `.padStart(14);
  console.log(chalk.bold("=== Single Order Gas Benchmarks ==="));
  console.log(
    chalk.gray("--------------+--------------+--------------+--------------"),
  );
  console.log(
    ["settlements", "refunds", "gasToken", "gas/order"]
      .map((header) => chalk.cyan(pad(header)))
      .join(chalk.gray("|")),
  );
  console.log(
    chalk.gray("--------------+--------------+--------------+--------------"),
  );
  for (const [settlements, refunds, gasToken] of [
    [1, 0, 0],
    [1, 1, 0],
    [6, 6, 0],
    [7, 7, 0],
    [8, 8, 0],
    [9, 9, 0],
    [1, 4, 2],
    [1, 0, 5],
  ]) {
    let { gasUsed } = await fixture.settle({
      tokens: 2,
      trades: 1,
      interactions: 1,
      refunds,
      gasToken,
    });
    if (settlements > 1) {
      const { gasUsed: refundlessGasUsed } = await fixture.settle({
        tokens: 2,
        trades: 1,
        interactions: 1,
        refunds: 0,
        gasToken: 0,
      });

      // NOTE: We are simulating running `settlements - 1` settlements without
      // any gas refunds, and then a last one with "lots" of refunds. This is
      // so we can simulate "continuous" gas costs where refunds are bundled up
      // into larger batches instead of applying on refund per settlement.
      // Compute the average gas used per order.
      gasUsed = refundlessGasUsed
        .mul(settlements - 1)
        .add(gasUsed)
        .div(settlements);
    }

    console.log(
      [
        pad(settlements),
        pad(refunds),
        pad(gasToken),
        chalk.yellow(pad(gasUsed.toString())),
      ].join(chalk.gray("|")),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
