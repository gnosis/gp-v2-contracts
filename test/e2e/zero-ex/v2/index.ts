import { ERC20Proxy, Exchange, ZRXToken } from "@0x/contract-artifacts-v2";
import { BigNumberish, BytesLike, Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import { SimpleOrder } from "..";
import { TypedDataDomain } from "../../../../src/ts";

// NOTE: Order type from:
// <https://0x.org/docs/guides/v2-specification#order>
export interface Order {
  makerAddress: string;
  takerAddress: string;
  feeRecipientAddress: string;
  senderAddress: string;
  makerAssetAmount: BigNumberish;
  takerAssetAmount: BigNumberish;
  makerFee: BigNumberish;
  takerFee: BigNumberish;
  expirationTimeSeconds: BigNumberish;
  salt: BigNumberish;
  makerAssetData: BytesLike;
  takerAssetData: BytesLike;
}

const ORDER_TYPE_DESCRIPTOR = {
  Order: [
    { name: "makerAddress", type: "address" },
    { name: "takerAddress", type: "address" },
    { name: "feeRecipientAddress", type: "address" },
    { name: "senderAddress", type: "address" },
    { name: "makerAssetAmount", type: "uint256" },
    { name: "takerAssetAmount", type: "uint256" },
    { name: "makerFee", type: "uint256" },
    { name: "takerFee", type: "uint256" },
    { name: "expirationTimeSeconds", type: "uint256" },
    { name: "salt", type: "uint256" },
    { name: "makerAssetData", type: "bytes" },
    { name: "takerAssetData", type: "bytes" },
  ],
};

export interface SignedOrder {
  order: Order;
  hash: BytesLike;
  signature: BytesLike;
}

function encodeErc20AssetData(tokenAddress: BytesLike): string {
  // NOTE: ERC20 proxy asset data defined in:
  // <https://github.com/0xProject/0x-monorepo/blob/master/contracts/asset-proxy/contracts/src/ERC20Proxy.sol>

  const { id, hexDataSlice } = ethers.utils;
  const PROXY_ID = hexDataSlice(id("ERC20Token(address)"), 0, 4);

  return ethers.utils.hexConcat([
    PROXY_ID,
    ethers.utils.defaultAbiCoder.encode(["address"], [tokenAddress]),
  ]);
}

export async function signSimpleOrder(
  maker: Wallet,
  domain: TypedDataDomain,
  simpleOrder: SimpleOrder,
): Promise<SignedOrder> {
  const order = {
    ...simpleOrder,
    makerAddress: maker.address,
    makerAssetData: encodeErc20AssetData(simpleOrder.makerAssetAddress),
    takerAssetData: encodeErc20AssetData(simpleOrder.takerAssetAddress),

    // NOTE: Unused.
    expirationTimeSeconds: 0xffffffff,
    salt: ethers.constants.Zero,

    // NOTE: Setting taker and sender address to `address(0)` means that the
    // order can be executed (sender) against any counterparty (taker). For the
    // purposes of GPv2, these need to be either `address(0)` or the settlement
    // contract.
    takerAddress: ethers.constants.AddressZero,
    senderAddress: ethers.constants.AddressZero,

    // NOTE: Include no additional fees. I am not sure how this is used by
    // market makers, but in theory this can be used to assign an additional
    // fee, on top of the 0x protocol fee, to the GPv2 settlement contract.
    feeRecipientAddress: ethers.constants.AddressZero,
    makerFee: 0,
    takerFee: 0,
  };

  const hash = ethers.utils._TypedDataEncoder.hash(
    domain,
    ORDER_TYPE_DESCRIPTOR,
    order,
  );

  // NOTE: Use EIP-712 signing scheme for the order. The signature is just the
  // ECDSA signature post-fixed with the signature scheme ID (0x02):
  // <https://0x.org/docs/guides/v3-specification#signature-types>

  const EIP712_SIGNATURE_ID = 0x02;
  const { v, r, s } = ethers.utils.splitSignature(
    await maker._signTypedData(domain, ORDER_TYPE_DESCRIPTOR, order),
  );
  const signature = ethers.utils.solidityPack(
    ["uint8", "bytes32", "bytes32", "uint8"],
    [v, r, s, EIP712_SIGNATURE_ID],
  );

  return { order, hash, signature };
}

export interface Deployment {
  zrxToken: Contract;
  exchange: Contract;
  erc20Proxy: Contract;
  domainSeparator: TypedDataDomain;
}

export async function deployExchange(deployer: Wallet): Promise<Deployment> {
  const zrxToken = await waffle.deployContract(
    deployer,
    ZRXToken.compilerOutput,
  );

  const zrxAssetData = encodeErc20AssetData(zrxToken.address);
  const exchange = await waffle.deployContract(
    deployer,
    Exchange.compilerOutput,
    [zrxAssetData],
  );

  const erc20Proxy = await waffle.deployContract(
    deployer,
    ERC20Proxy.compilerOutput,
  );

  await erc20Proxy.addAuthorizedAddress(exchange.address);
  await exchange.registerAssetProxy(erc20Proxy.address);

  return {
    zrxToken,
    exchange,
    erc20Proxy,
    // NOTE: Domain separator parameters taken from:
    // <https://0x.org/docs/guides/v2-specification#eip-712-usage>
    domainSeparator: {
      name: "0x Protocol",
      version: "2",
      verifyingContract: exchange.address,
    },
  };
}
