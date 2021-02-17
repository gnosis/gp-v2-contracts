// NOTE: Register the trace hook right away. This ensures that the Hardhat
// runtime environment is initialized **after** the trace hook is installed,
// otherwise the hook has no effect.
import "./hook/register";

import chalk from "chalk";

import { BenchFixture } from "../fixture";

import { decodeGasTrace, GasTrace } from "./gas";
import { getLastTrace } from "./hook";

async function main() {
  const fixture = await BenchFixture.create();

  const tx = await fixture.settle({
    tokens: 4,
    trades: 6,
    interactions: 2,
    refunds: 3,
    gasToken: 0,
  });
  const trace = getLastTrace(fixture.settlement.interface.getSighash("settle"));
  if (!trace) {
    throw new Error("error reading settlement transaction trace.");
  }

  const gasTrace = decodeGasTrace(tx, trace);
  formatGasTrace(gasTrace);
}

function formatGasTrace(gasTrace: GasTrace, path: GasTrace[] = []) {
  const isLast = ({ children }: GasTrace, child: GasTrace) =>
    children[children.length - 1] === child;
  const { padding } = path.reduceRight(
    ({ child, padding }, parent) => ({
      child: parent,
      padding: `${
        child
          ? isLast(parent, child)
            ? "    "
            : "│   "
          : isLast(parent, gasTrace)
          ? "└── "
          : "├── "
      }${padding}`,
    }),
    {
      child: undefined as GasTrace | undefined,
      padding: "",
    },
  );

  const { name, cumulativeGas, gasUsed, gasRefund, children } = gasTrace;
  const chalkedName = name.match(/^<.*>$/)
    ? chalk.bold(chalk.gray(name))
    : name.match(/^@/)
    ? chalk.magenta(name)
    : name.match(/\[.*\]\./)
    ? chalk.cyan(name)
    : chalk.bold(chalk.cyan(name));

  let gas = `${chalk.yellow(cumulativeGas)}`;
  if (gasUsed) {
    gas = `${gas} ${chalk.red(`-${gasUsed}`)}`;
  }
  if (gasRefund) {
    gas = `${gas} ${chalk.green(`+${gasRefund}`)}`;
  }

  console.log(`${padding}${chalkedName} ${gas}`);
  const subpath = [...path, gasTrace];
  for (const child of children) {
    formatGasTrace(child, subpath);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
