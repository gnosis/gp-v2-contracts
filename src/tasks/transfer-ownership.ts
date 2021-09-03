import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";

import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { proxyInterface } from "../ts";

import { getDeployedContract } from "./ts/deployment";
import { getOwnerSigner } from "./ts/signers";
import { prompt, transactionUrl } from "./ts/tui";

interface Args {
  newOwner: string;
  dryRun: boolean;
}

async function transferOwnership(
  { newOwner, dryRun }: Args,
  hre: HardhatRuntimeEnvironment,
) {
  const owner = await getOwnerSigner(hre);
  const authenticator = await getDeployedContract(
    "GPv2AllowListAuthentication",
    hre,
  );
  const proxy = proxyInterface(authenticator);

  console.log(`transfering ownership from ${owner.address} to ${newOwner}`);
  if (dryRun) {
    await proxy.connect(owner).callStatic.transferOwnership(newOwner);
    console.log("Successfully simulated ownership transfer.");
  } else if (await prompt("Transfer ownership?")) {
    const tx = await proxy.connect(owner).transferOwnership(newOwner);
    console.log(transactionUrl(hre, tx));
    await tx.wait();
    console.log("Ownership transferred.");
  } else {
    console.log("Operation aborted.");
  }
}

const setupTransferOwnershipTask: () => void = () => {
  task(
    "transfer-ownership",
    "Transfer ownership of the GPv2 authenticator contract",
  )
    .addPositionalParam<string>(
      "newOwner",
      `The account to transfer ownership of the GPv2 authenticator to`,
    )
    .addFlag(
      "dryRun",
      "Just simulate the transfer instead of executing the transaction on the blockchain.",
    )
    .setAction(transferOwnership);
};

export { setupTransferOwnershipTask };
