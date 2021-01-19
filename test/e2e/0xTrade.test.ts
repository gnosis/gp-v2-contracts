import { ERC20Proxy, Exchange } from "@0x/contract-artifacts";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import Debug from "debug";
import { BigNumberish, BytesLike, Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";

import { deployTestContracts } from "./fixture";

const debug = Debug("test:e2e:0xTrade");

interface ZeroExOrder {
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
  makerFeeAssetData: BytesLike;
  takerFeeAssetData: BytesLike;
}

const ZERO_EX_ORDER_TYPE_DESCRIPTOR = {
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
    { name: "makerFeeAssetData", type: "bytes" },
    { name: "takerFeeAssetData", type: "bytes" },
  ],
};

interface ZeroExSignedOrder {
  order: ZeroExOrder;
  hash: BytesLike;
  signature: BytesLike;
}

interface ZeroExSimpleOrder {
  makerAssetAmount: BigNumberish;
  takerAssetAmount: BigNumberish;
  makerAssetAddress: BytesLike;
  takerAssetAddress: BytesLike;
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

async function signZeroExSimpleOrder(
  maker: Wallet,
  domain: TypedDataDomain,
  simpleOrder: ZeroExSimpleOrder,
): Promise<ZeroExSignedOrder> {
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
    // purposes of GPv2, this needs to be either `address(0)` or the settlement
    // contract.
    takerAddress: ethers.constants.AddressZero,
    senderAddress: ethers.constants.AddressZero,

    // NOTE: Include no additional fees. I am not sure how this is used by
    // market makers, but in theory this can be used to assign an additional
    // fee, on top of the 0x protocol fee, to the GPv2 settlement contract.
    feeRecipientAddress: ethers.constants.AddressZero,
    makerFee: 0,
    takerFee: 0,
    makerFeeAssetData: "0x",
    takerFeeAssetData: "0x",
  };

  const hash = ethers.utils._TypedDataEncoder.hash(
    domain,
    ZERO_EX_ORDER_TYPE_DESCRIPTOR,
    order,
  );

  const ETHSIGN_SIGNATURE_ID = 0x03;
  const { v, r, s } = ethers.utils.splitSignature(
    //await maker._signTypedData(domain, ZERO_EX_ORDER_TYPE_DESCRIPTOR, order),
    await maker.signMessage(hash),
  );
  const signature = ethers.utils.solidityPack(
    ["uint8", "uint8", "bytes32", "bytes32"],
    [ETHSIGN_SIGNATURE_ID, v, r, s],
  );

  return { order, hash, signature };
}

describe.only("E2E: Can settle a 0x trade", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let trader: Wallet;
  let marketMaker: Wallet;

  let settlement: Contract;
  let allowanceManager: Contract;
  let domainSeparator: TypedDataDomain;

  let owl: Contract;
  let gno: Contract;

  let zeroEx: {
    exchange: Contract;
    erc20Proxy: Contract;
    domainSeparator: TypedDataDomain;
  };

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      allowanceManager,
      wallets: [solver, trader, marketMaker],
    } = deployment);

    const { authenticator, owner } = deployment;
    await authenticator.connect(owner).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    owl = await waffle.deployContract(deployer, ERC20, ["OWL", 18]);
    gno = await waffle.deployContract(deployer, ERC20, ["GNO", 18]);

    const exchange = await waffle.deployContract(
      deployer,
      Exchange.compilerOutput,
      [chainId],
    );
    const erc20Proxy = await waffle.deployContract(
      deployer,
      ERC20Proxy.compilerOutput,
    );

    await erc20Proxy.addAuthorizedAddress(exchange.address);
    await exchange.registerAssetProxy(erc20Proxy.address);
    zeroEx = {
      exchange,
      erc20Proxy,
      domainSeparator: {
        name: "0x Protocol",
        version: "3.0.0",
        chainId,
        verifyingContract: exchange.address,
      },
    };
  });

  it("should settle an EOA trade with a 0x trade", async () => {
    // Settles a market order buying 1 GNO for 120 OWL and get matched with a
    // market maker using 0x orders.

    const encoder = new SettlementEncoder(domainSeparator);

    await owl.mint(trader.address, ethers.utils.parseEther("130"));
    await owl
      .connect(trader)
      .approve(allowanceManager.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        buyToken: gno.address,
        sellToken: owl.address,
        buyAmount: ethers.utils.parseEther("1.0"),
        sellAmount: ethers.utils.parseEther("120.0"),
        feeAmount: ethers.utils.parseEther("10.0"),
        validTo: 0xffffffff,
        appData: 1,
      },
      trader,
      //SigningScheme.TYPED_DATA,
      SigningScheme.MESSAGE,
    );

    await gno.mint(marketMaker.address, ethers.utils.parseEther("1000.0"));
    await gno
      .connect(marketMaker)
      .approve(zeroEx.erc20Proxy.address, ethers.constants.MaxUint256);
    encoder.encodeInteraction({
      target: owl.address,
      callData: owl.interface.encodeFunctionData("approve", [
        zeroEx.erc20Proxy.address,
        ethers.utils.parseEther("1.0"),
      ]),
    });
    const zeroExSignedOrder = await signZeroExSimpleOrder(
      marketMaker,
      zeroEx.domainSeparator,
      {
        makerAssetAddress: gno.address,
        makerAssetAmount: ethers.utils.parseEther("1000.0"),
        takerAssetAddress: owl.address,
        takerAssetAmount: ethers.utils.parseEther("1000.0").mul(110),
      },
    );
    const { orderHash: zeroExOrderHash } = await zeroEx.exchange.getOrderInfo(
      zeroExSignedOrder.order,
    );
    expect(zeroExOrderHash).to.equal(zeroExSignedOrder.hash);
    encoder.encodeInteraction({
      target: zeroEx.exchange.address,
      callData: zeroEx.exchange.interface.encodeFunctionData("fillOrder", [
        zeroExSignedOrder.order,
        ethers.utils.parseEther("1.0"),
        zeroExSignedOrder.signature,
      ]),
    });

    await owl
      .connect(trader)
      .approve(zeroEx.erc20Proxy.address, ethers.constants.MaxUint256);
    await zeroEx.exchange
      .connect(trader)
      .fillOrder(
        zeroExSignedOrder.order,
        ethers.utils.parseEther("110.0"),
        zeroExSignedOrder.signature,
        { gasLimit: 1e6 },
      );

    const tx = await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [owl.address]: 1,
        [gno.address]: 120,
      }),
    );

    const { gasUsed } = await tx.wait();
    debug(`gas used: ${gasUsed}`);

    expect(await gno.balanceOf(trader.address)).to.deep.equal(
      ethers.utils.parseEther("1.0"),
    );
    expect(await gno.balanceOf(marketMaker.address)).to.deep.equal(
      ethers.utils.parseEther("999.0"),
    );
  });
});
