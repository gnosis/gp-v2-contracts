import chalk from "chalk";

import { OrderBalance, OrderKind } from "../src/ts";

import { BenchFixture } from "./fixture";

async function main() {
  const fixture = await BenchFixture.create();

  const pad = (x: unknown) => ` ${x} `.padStart(14);

  console.log(chalk.bold("=== Balancer Gas Benchmarks ==="));
  console.log(
    chalk.gray(
      "--------------+--------------+--------------+--------------+--------------",
    ),
  );
  console.log(
    ["hops", "kind", "sell balance", "buy balance", "gas"]
      .map((header) => chalk.cyan(pad(header)))
      .join(chalk.gray("|")),
  );
  console.log(
    chalk.gray(
      "--------------+--------------+--------------+--------------+--------------",
    ),
  );

  for (let hops = 1; hops <= 3; hops++) {
    for (const kind of [OrderKind.SELL, OrderKind.BUY]) {
      for (const sellTokenBalance of [
        OrderBalance.ERC20,
        OrderBalance.EXTERNAL,
        OrderBalance.INTERNAL,
      ]) {
        for (const buyTokenBalance of [
          OrderBalance.ERC20,
          OrderBalance.INTERNAL,
        ]) {
          const { gasUsed } = await fixture.swap({
            hops,
            kind,
            sellTokenBalance,
            buyTokenBalance,
          });
          console.log(
            [
              ...[hops, kind, sellTokenBalance, buyTokenBalance].map(pad),
              chalk.yellow(pad(gasUsed.toString())),
            ].join(chalk.gray("|")),
          );
        }
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
