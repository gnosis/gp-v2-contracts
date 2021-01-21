import { fullMigrateAsync, artifacts } from "@0x/contracts-zero-ex";
import { BigNumberish, BytesLike, Contract, Wallet } from "ethers";
import { ethers } from "hardhat";

import { SimpleOrder } from "..";
import { TypedDataDomain } from "../../../../src/ts";

import { withCompatProvider } from "./compat";

export interface Deployment {
  contract: Contract;
  domainSeparator: TypedDataDomain;
}

export async function deployExchange(deployer: Wallet): Promise<Deployment> {
  const zeroEx = await withCompatProvider((compatProvider) =>
    fullMigrateAsync(deployer.address, compatProvider, {
      from: deployer.address,
      gas: 9e6,
    }),
  );

  const contract = new Contract(
    zeroEx.address,
    artifacts.INativeOrdersFeature.compilerOutput.abi,
    deployer,
  );
  const { chainId } = await ethers.provider.getNetwork();

  return {
    contract,
    domainSeparator: {
      name: "ZeroEx",
      version: "1.0.0",
      chainId,
      verifyingContract: contract.address,
    },
  };
}

export interface RFQOrder {
  makerToken: string;
  takerToken: string;
  makerAmount: BigNumberish;
  takerAmount: BigNumberish;
  maker: string;
  taker: string;
  txOrigin: string;
  pool: string;
  expiry: BigNumberish;
  salt: BigNumberish;
}

const RFQ_ORDER_TYPE_DESCRIPTOR = {
  RfqOrder: [
    { name: "makerToken", type: "address" },
    { name: "takerToken", type: "address" },
    { name: "makerAmount", type: "uint128" },
    { name: "takerAmount", type: "uint128" },
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "txOrigin", type: "address" },
    { name: "pool", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "salt", type: "uint256" },
  ],
};

export interface SignedRFQOrder {
  order: RFQOrder;
  hash: BytesLike;
  signature: Signature;
}

export interface Signature {
  signatureType: number;
  v: number;
  r: string;
  s: string;
}

export async function signSimpleOrder(
  maker: Wallet,
  rfqOrigin: Wallet,
  domain: TypedDataDomain,
  o: SimpleOrder,
): Promise<SignedRFQOrder> {
  const order = {
    makerToken: o.makerAssetAddress,
    takerToken: o.takerAssetAddress,
    makerAmount: o.makerAssetAmount,
    takerAmount: o.takerAssetAmount,
    maker: maker.address,
    taker: o.takerAddress,
    txOrigin: rfqOrigin.address,

    // NOTE: Not used.
    pool: ethers.constants.HashZero,
    expiry: 0xffffffff,
    salt: 0,
  };

  const hash = ethers.utils._TypedDataEncoder.hash(
    domain,
    RFQ_ORDER_TYPE_DESCRIPTOR,
    order,
  );

  const EIP712_SIGNATURE_ID = 0x02;
  const { v, r, s } = ethers.utils.splitSignature(
    await maker._signTypedData(domain, RFQ_ORDER_TYPE_DESCRIPTOR, order),
  );
  const signature = {
    signatureType: EIP712_SIGNATURE_ID,
    v,
    r,
    s,
  };

  return { order, hash, signature };
}
