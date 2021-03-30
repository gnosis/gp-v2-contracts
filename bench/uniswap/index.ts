import chalk from "chalk";
import { BigNumber } from "ethers";

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
    ["hops", "strategy", "batch size", "direct swap", "batch swap"]
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
    const formatGas = (gasUsed: BigNumber) =>
      (gasUsed.lt(directSwap) ? chalk.green : chalk.red)(
        pad(gasUsed.toString()),
      );

    const { gasUsed: settleSwap } = await fixture.settleSwap(hops);
    console.log(
      [
        ...[hops, "gp router", 1].map(pad),
        chalk.yellow(pad(directSwap.toString())),
        formatGas(settleSwap),
      ].join(chalk.gray("|")),
    );

    for (const useRouter of [true, false]) {
      const strategy = useRouter ? "router" : "pair";
      for (let batchSize = 1; batchSize <= 5; batchSize++) {
        const { gasUsed: totalBatchSwap } = await fixture.batchSwap({
          batchSize,
          hops,
          useRouter,
        });
        const batchSwap = totalBatchSwap.div(batchSize);

        console.log(
          [
            ...[hops, strategy, batchSize].map(pad),
            chalk.yellow(pad(directSwap.toString())),
            formatGas(batchSwap),
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
