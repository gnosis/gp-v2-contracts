import chalk from "chalk";

import { BenchFixture } from "./fixture";

async function main() {
  const fixture = await BenchFixture.create();

  const pad = (x: unknown) => ` ${x} `.padStart(14);
  console.log(chalk.bold("=== Single Order Gas Benchmarks ==="));
  console.log(chalk.gray("--------------+--------------"));
  console.log(
    ["gasToken", "gas"]
      .map((header) => chalk.cyan(pad(header)))
      .join(chalk.gray("|")),
  );
  console.log(chalk.gray("--------------+--------------"));
  for (const gasToken of [0, 5]) {
    const { gasUsed } = await fixture.settle({
      tokens: 2,
      trades: 1,
      interactions: 1,
      refunds: 0,
      gasToken,
    });

    console.log(
      [pad(gasToken), chalk.yellow(pad(gasUsed.toString()))].join(
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
