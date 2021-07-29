import { expect } from "chai";
import { ethers, waffle } from "hardhat";

import { deployMinerPayoutContract, MINER_PAYOUT_CODE } from "../src/ts";

describe("Miner Payout", () => {
  const [signer] = waffle.provider.getWallets();

  it("can deploy the miner payout contract", async () => {
    const minerPayout = await deployMinerPayoutContract(signer);
    const code = await ethers.provider.getCode(minerPayout.address);

    expect(code).to.equal(MINER_PAYOUT_CODE);
  });

  it("sends the value to the coinbase address", async () => {
    const amount = ethers.utils.parseEther("4.2");
    const minerPayout = await deployMinerPayoutContract(signer);

    const { blockHash } = await minerPayout.deployTransaction.wait();
    const { miner } = await ethers.provider.getBlock(blockHash);

    const preMineBalance = await ethers.provider.getBalance(miner);
    await ethers.provider.send("evm_mine", []);
    const startingBalance = await ethers.provider.getBalance(miner);
    const blockReward = startingBalance.sub(preMineBalance);

    await signer.sendTransaction({
      to: minerPayout.address,
      value: amount,
      gasPrice: 0,
    });
    const finalBalance = await ethers.provider.getBalance(miner);
    const minerPayoutAmount = finalBalance
      .sub(startingBalance)
      .sub(blockReward);

    expect(minerPayoutAmount).to.equal(amount);
  });
});
