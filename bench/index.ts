import chalk from "chalk";

import { BenchFixture } from "./fixture";

async function main() {
  const fixture = await BenchFixture.create();

  const pad = (x: unknown) => ` ${x} `.padStart(14);
  console.log(chalk.bold("=== Settlement Gas Benchmarks ==="));
  console.log(
    chalk.gray(
      "--------------+--------------+--------------+--------------+--------------",
    ),
  );
  console.log(
    ["tokens", "trades", "interactions", "refunds", "gas"]
      .map((header) => chalk.cyan(pad(header)))
      .join(chalk.gray("|")),
  );
  console.log(
    chalk.gray(
      "--------------+--------------+--------------+--------------+--------------",
    ),
  );
  for (const [tokens, trades, interactions, refunds] of [
    [2, 10, 0, 0],
    [3, 10, 0, 0],
    [4, 10, 0, 0],
    [5, 10, 0, 0],
    [6, 10, 0, 0],
    [7, 10, 0, 0],
    [8, 10, 0, 0],
    [8, 20, 0, 0],
    [8, 30, 0, 0],
    [8, 40, 0, 0],
    [8, 50, 0, 0],
    [8, 60, 0, 0],
    [8, 70, 0, 0],
    [8, 80, 0, 0],
    [2, 10, 1, 0],
    [2, 10, 2, 0],
    [2, 10, 3, 0],
    [2, 10, 4, 0],
    [2, 10, 5, 0],
    [2, 10, 6, 0],
    [2, 10, 7, 0],
    [2, 10, 8, 0],
    [2, 50, 0, 10],
    [2, 50, 0, 15],
    [2, 50, 0, 20],
    [2, 50, 0, 25],
    [2, 50, 0, 30],
    [2, 50, 0, 35],
    [2, 50, 0, 40],
    [2, 50, 0, 45],
    [2, 50, 0, 50],
    [2, 2, 0, 0],
    [2, 1, 1, 0],
    [10, 80, 10, 20],
  ]) {
    const { gasUsed } = await fixture.settle({
      tokens,
      trades,
      interactions,
      refunds,
      gasToken: 0,
    });

    console.log(
      [
        ...[tokens, trades, interactions, refunds].map(pad),
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
