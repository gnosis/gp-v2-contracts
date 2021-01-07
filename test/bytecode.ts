import { artifacts, ethers } from "hardhat";

export async function builtAndDeployedMetadataCoincide(
  contractAddress: string,
  contractName: string,
): Promise<boolean> {
  const contractArtifacts = await artifacts.readArtifact(contractName);

  const code = await ethers.provider.send("eth_getCode", [
    contractAddress,
    "latest",
  ]);

  // NOTE: The last 53 bytes in a deployed contract's bytecode contains the
  // contract metadata. Compare the deployed contract's metadata with the
  // compiled contract's metadata.
  // <https://docs.soliditylang.org/en/v0.7.6/metadata.html>
  const metadata = (bytecode: string) => bytecode.slice(-106);

  return metadata(code) === metadata(contractArtifacts.deployedBytecode);
}
