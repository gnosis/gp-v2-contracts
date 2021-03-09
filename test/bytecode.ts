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

export async function readImmutables(
  fullyQualifiedContractName: string,
  contractAddress: string,
): Promise<string[]> {
  const buildInfo = await artifacts.getBuildInfo(fullyQualifiedContractName);
  if (buildInfo === undefined) {
    throw new Error(`missing ${fullyQualifiedContractName} build info`);
  }

  const [sourcePath, contractName] = fullyQualifiedContractName.split(":");
  const immutableReferences =
    buildInfo.output.contracts[sourcePath][contractName].evm.deployedBytecode
      .immutableReferences || {};

  // NOTE: For each immutable reference, it may have multiple code locations
  // where it appears in the final bytecode. Just pick the first one so we can
  // read its value.
  const immutableLocations = Object.values(immutableReferences).map(
    ([firstLocation]) => firstLocation,
  );

  const code = await ethers.provider.send("eth_getCode", [
    contractAddress,
    "latest",
  ]);

  const immutableValues = immutableLocations.map(({ start, length }) =>
    ethers.utils.hexDataSlice(code, start, start + length),
  );

  return immutableValues;
}

export function immutableAsAddress(value: string): string {
  const ADDRESS_IMMUTABLE_SLOT_LENGTH = 32;
  const ADDRESS_BYTE_LENGTH = 20;

  if (ethers.utils.hexDataLength(value) !== ADDRESS_IMMUTABLE_SLOT_LENGTH) {
    throw new Error("invalid address immutable value");
  }

  return ethers.utils.getAddress(
    ethers.utils.hexDataSlice(
      value,
      ADDRESS_IMMUTABLE_SLOT_LENGTH - ADDRESS_BYTE_LENGTH,
    ),
  );
}

export async function readVaultRelayerImmutables(
  contractAddress: string,
): Promise<{
  vault: string;
  creator: string;
}> {
  const [creator, vault] = await readImmutables(
    "src/contracts/GPv2VaultRelayer.sol:GPv2VaultRelayer",
    contractAddress,
  );

  return {
    creator: immutableAsAddress(creator),
    vault: immutableAsAddress(vault),
  };
}
