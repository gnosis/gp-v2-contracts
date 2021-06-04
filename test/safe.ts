import GnosisSafe from "@gnosis.pm/safe-contracts/build/artifacts/contracts/GnosisSafe.sol/GnosisSafe.json";
import CompatibilityFallbackHandler from "@gnosis.pm/safe-contracts/build/artifacts/contracts/handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json";
import GnosisSafeProxyFactory from "@gnosis.pm/safe-contracts/build/artifacts/contracts/proxies/GnosisSafeProxyFactory.sol/GnosisSafeProxyFactory.json";
import { Signer, Contract } from "ethers";
import { ethers, waffle } from "hardhat";

export class GnosisSafeManager {
  constructor(
    readonly deployer: Signer,
    readonly masterCopy: Contract,
    readonly signingFallback: Contract,
    readonly proxyFactory: Contract,
  ) {}

  static async init(deployer: Signer): Promise<GnosisSafeManager> {
    const masterCopy = await waffle.deployContract(deployer, GnosisSafe);
    const proxyFactory = await waffle.deployContract(
      deployer,
      GnosisSafeProxyFactory,
    );
    const signingFallback = await waffle.deployContract(
      deployer,
      CompatibilityFallbackHandler,
    );
    return new GnosisSafeManager(
      deployer,
      masterCopy,
      signingFallback,
      proxyFactory,
    );
  }

  async newSafe(
    owners: string[],
    threshold: number,
    fallback = ethers.constants.AddressZero,
  ): Promise<Contract> {
    const proxyAddress = await this.proxyFactory.callStatic.createProxy(
      this.masterCopy.address,
      "0x",
    );
    await this.proxyFactory.createProxy(this.masterCopy.address, "0x");
    const safe = await ethers.getContractAt(GnosisSafe.abi, proxyAddress);
    await safe.setup(
      owners,
      threshold,
      ethers.constants.AddressZero,
      "0x",
      fallback,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero,
    );
    return safe;
  }
}
