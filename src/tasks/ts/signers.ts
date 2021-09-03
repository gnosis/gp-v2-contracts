import type { HardhatRuntimeEnvironment, SignerWithAddress } from "hardhat/types";

export async function getOwnerSigner({
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment): Promise<SignerWithAddress> {
  const { manager } = await getNamedAccounts();
  const signer = (await ethers.getSigners()).find(
    (signer) => signer.address == manager,
  );
  if (signer == undefined) {
    throw new Error(
      'No owner found among the signers. Did you export the owner\'s private key with "export PK=<your key>"?',
    );
  }
  return signer;
}
