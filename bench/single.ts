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
    ["settlement", "include fees", "refunds", "gas"]
      .map((header) => chalk.cyan(pad(header)))
      .join(chalk.gray("|")),
  );
  console.log(
    chalk.gray("--------------+--------------+--------------+--------------"),
  );
  for (const [kind, includeFees, refunds] of [
    ["standard", undefined, 0],
    ["single", true, 0],
    ["single", false, 0],
    ["standard", undefined, 1],
    ["single", true, 1],
    ["single", false, 1],
    ["standard", undefined, 2],
    ["single", true, 2],
    ["single", false, 2],
  ] as const) {
    const { gasUsed } =
      kind === "standard"
        ? await fixture.settle({
            tokens: 2,
            trades: 1,
            interactions: 1,
            refunds,
          })
        : await fixture.settleOrder({
            includeFees: includeFees === true,
            refunds,
          });

    console.log(
      [
        ...[kind, includeFees ?? "-", refunds].map(pad),
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
