import readline from "readline";

import { HardhatRuntimeEnvironment } from "hardhat/types";

export async function prompt(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const response = await new Promise<string>((resolve) =>
    rl.question(`${message} (y/N) `, (response) => resolve(response)),
  );
  return "y" === response.toLowerCase();
}

export interface TransactionLike {
  transactionHash: string;
}

export function transactionUrl(
  { network }: HardhatRuntimeEnvironment,
  { transactionHash }: TransactionLike,
): string {
  switch (network.name) {
    case "mainnet":
      return `https://etherscan.io/tx/${transactionHash}`;
    case "rinkeby":
      return `https://rinkeby.etherscan.io/tx/${transactionHash}`;
    case "xdai":
      return `https://blockscout.com/xdai/mainnet/tx/${transactionHash}`;
    default:
      return transactionHash;
  }
}
