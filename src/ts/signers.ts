import { _TypedDataEncoder } from "@ethersproject/hash";
import type { JsonRpcProvider } from "@ethersproject/providers";
import { ethers, Signer } from "ethers";

import {
  TypedDataDomain,
  TypedDataSigner,
  TypedDataTypes,
} from "./types/ethers";

/**
 * Wrapper around a TypedDataSigner Signer object that implements `_signTypedData` using
 * `eth_signTypedData_v3` instead of `eth_signTypedData_v4`.
 *
 * Takes a Signer instance on creation.
 * All other Signer methods are proxied to initial instance.
 */
export class TypedDataV3Signer implements TypedDataSigner {
  signer: Signer;
  provider?: JsonRpcProvider | undefined;
  _isSigner = true;

  constructor(signer: Signer) {
    this.signer = signer;
    this.provider = signer.provider as JsonRpcProvider;
  }

  async _signTypedData(
    domain: TypedDataDomain,
    types: TypedDataTypes,
    data: Record<string, unknown>,
  ): Promise<string> {
    if (!this.provider) {
      // Likely set at this point, but throwing when empty just in case
      throw new Error("Signer does not have a provider set");
    }

    const provider = this.provider;

    const populated = await _TypedDataEncoder.resolveNames(
      domain,
      types,
      data,
      (name: string) => {
        return provider.resolveName(name);
      },
    );

    const payload = _TypedDataEncoder.getPayload(
      populated.domain,
      types,
      populated.value,
    );
    const msg = JSON.stringify(payload);

    const address = await this.getAddress();

    // Actual signing
    return (await provider.send("eth_signTypedData_v3", [
      address.toLowerCase(),
      msg,
    ])) as string;
  }

  // --- start boilerplate proxy methods ---

  getAddress(): Promise<string> {
    return this.signer.getAddress();
  }
  signMessage(message: string | ethers.utils.Bytes): Promise<string> {
    return this.signer.signMessage(message);
  }
  signTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>,
  ): Promise<string> {
    return this.signer.signTransaction(transaction);
  }
  connect(provider: ethers.providers.Provider): ethers.Signer {
    return this.signer.connect(provider);
  }
  getBalance(blockTag?: ethers.providers.BlockTag): Promise<ethers.BigNumber> {
    return this.signer.getBalance(blockTag);
  }
  getTransactionCount(blockTag?: ethers.providers.BlockTag): Promise<number> {
    return this.signer.getTransactionCount(blockTag);
  }
  estimateGas(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>,
  ): Promise<ethers.BigNumber> {
    return this.signer.estimateGas(transaction);
  }
  call(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>,
    blockTag?: ethers.providers.BlockTag,
  ): Promise<string> {
    return this.signer.call(transaction, blockTag);
  }
  sendTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>,
  ): Promise<ethers.providers.TransactionResponse> {
    return this.signer.sendTransaction(transaction);
  }
  getChainId(): Promise<number> {
    return this.signer.getChainId();
  }
  getGasPrice(): Promise<ethers.BigNumber> {
    return this.signer.getGasPrice();
  }
  resolveName(name: string): Promise<string> {
    return this.signer.resolveName(name);
  }
  checkTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>,
  ): ethers.utils.Deferrable<ethers.providers.TransactionRequest> {
    return this.signer.checkTransaction(transaction);
  }
  populateTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>,
  ): Promise<ethers.providers.TransactionRequest> {
    return this.signer.populateTransaction(transaction);
  }
  _checkProvider(operation?: string): void {
    return this.signer._checkProvider(operation);
  }

  // --- end boilerplate proxy methods ---
}
