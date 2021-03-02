import chalk from "chalk";

import { BenchFixture } from "./fixture";

async function main() {
  const fixture = await BenchFixture.create();

  const pad = (x: unknown) => ` ${x} `.padStart(14);
  console.log(chalk.bold("=== Single Order Gas Benchmarks ==="));
  console.log(chalk.gray("--------------+--------------+--------------"));
  console.log(
    ["refunds", "gasToken", "gas"]
      .map((header) => chalk.cyan(pad(header)))
      .join(chalk.gray("|")),
  );
  console.log(chalk.gray("--------------+--------------+--------------"));
  for (const [refunds, gasToken] of [
    [0, 0],
    [2, 0],
    [4, 0],
    [8, 0],
    [0, 2],
    [2, 2],
    [4, 2],
    [0, 5],
  ]) {
    const { gasUsed } = await fixture.settle({
      tokens: 2,
      trades: 1,
      interactions: 1,
      refunds,
      gasToken,
    });

    console.log(
      [pad(refunds), pad(gasToken), chalk.yellow(pad(gasUsed.toString()))].join(
        chalk.gray("|"),
      ),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
