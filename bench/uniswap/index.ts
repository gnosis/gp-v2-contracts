import chalk from "chalk";

import { UniswapFixture } from "./fixture";

async function main() {
  const fixture = await UniswapFixture.create();

  const pad = (x: unknown) => ` ${x} `.padStart(14);

  console.log(chalk.bold("=== Uniswap Gas Benchmarks ==="));
  console.log(
    chalk.gray(
      "--------------+--------------+--------------+--------------+--------------",
    ),
  );
  console.log(
    ["hops", "use router", "batch size", "direct swap", "batch swap"]
      .map((header) => chalk.cyan(pad(header)))
      .join(chalk.gray("|")),
  );
  console.log(
    chalk.gray(
      "--------------+--------------+--------------+--------------+--------------",
    ),
  );
  for (let hops = 1; hops <= 3; hops++) {
    const { gasUsed: directSwap } = await fixture.directSwap(hops);

    for (const useRouter of [true, false]) {
      for (let batchSize = 1; batchSize <= 5; batchSize++) {
        const { gasUsed: totalBatchSwap } = await fixture.batchSwap({
          batchSize,
          hops,
          useRouter,
        });
        const batchSwap = totalBatchSwap.div(batchSize);

        const batchColour = batchSwap.lt(directSwap) ? chalk.green : chalk.red;
        console.log(
          [
            ...[hops, useRouter, batchSize].map(pad),
            chalk.yellow(pad(directSwap.toString())),
            batchColour(pad(batchSwap.toString())),
          ].join(chalk.gray("|")),
        );
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
