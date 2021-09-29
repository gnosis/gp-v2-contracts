import hre from "hardhat";

export async function setTime(timestamp: number): Promise<number> {
  return await hre.ethers.provider.send("evm_setNextBlockTimestamp", [
    timestamp,
  ]);
}

export async function synchronizeBlockchainAndCurrentTime(): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  return setTime(now);
}
