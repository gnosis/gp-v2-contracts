import "@nomiclabs/hardhat-ethers";

import { BigNumber, Contract } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export interface TokenDetails {
  contract: Contract;
  symbol: string | null;
  decimals: number | null;
  address: string;
}

export async function tokenDetails(
  address: string,
  hre: HardhatRuntimeEnvironment,
): Promise<TokenDetails> {
  const IERC20 = await hre.artifacts.readArtifact(
    "src/contracts/interfaces/IERC20.sol:IERC20",
  );
  const contract = new Contract(address, IERC20.abi, hre.ethers.provider);
  const [symbol, decimals] = await Promise.all([
    contract
      .symbol()
      .then((s: unknown) => (typeof s !== "string" ? null : s))
      .catch(() => null),
    contract
      .decimals()
      .then((s: unknown) => BigNumber.from(s))
      .catch(() => null),
  ]);
  return {
    contract,
    symbol,
    decimals,
    address,
  };
}
