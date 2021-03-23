import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import { Contract, ContractFactory, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  OrderBalance,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";
import { decodeOrder } from "../encoding";

import { deployTestContracts } from "./fixture";

describe("E2E: Dumb Smart Order", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let traders: Wallet[];

  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let tokens: [Contract, Contract];

  let SmartSellOrder: ContractFactory;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      vaultRelayer,
      wallets: [solver, ...traders],
    } = deployment);

    const { authenticator, manager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    tokens = [
      await waffle.deployContract(deployer, ERC20, ["T0", 18]),
      await waffle.deployContract(deployer, ERC20, ["T1", 18]),
    ];

    SmartSellOrder = await ethers.getContractFactory("SmartSellOrder");
  });

  it("permits trader allowance with settlement", async () => {
    // Settle half of the smart order.
    const encoder = new SettlementEncoder(domainSeparator);

    await tokens[0].mint(traders[0].address, ethers.utils.parseEther("1.01"));
    await tokens[0]
      .connect(traders[0])
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        sellToken: tokens[0].address,
        buyToken: tokens[1].address,
        sellAmount: ethers.utils.parseEther("1.0"),
        buyAmount: ethers.utils.parseEther("0.5"),
        feeAmount: ethers.utils.parseEther("0.01"),
        validTo: 0xffffffff,
        appData: 1,
      },
      traders[0],
      SigningScheme.EIP712,
    );

    const smartOrder = await SmartSellOrder.connect(traders[1]).deploy(
      settlement.address,
      tokens[1].address,
      tokens[0].address,
      0xffffffff,
      ethers.utils.parseEther("1.0"),
      ethers.utils.parseEther("0.1"),
    );
    await tokens[1].mint(traders[1].address, ethers.utils.parseEther("1.1"));
    await tokens[1]
      .connect(traders[1])
      .transfer(smartOrder.address, ethers.utils.parseEther("1.1"));

    const smartOrderSellAmount = ethers.utils.parseEther("0.5");
    const smartOrderTrade = decodeOrder(
      await smartOrder.orderForSellAmount(smartOrderSellAmount),
    );
    expect(smartOrderTrade).to.deep.equal({
      kind: OrderKind.SELL,
      partiallyFillable: false,
      sellToken: tokens[1].address,
      buyToken: tokens[0].address,
      receiver: traders[1].address,
      sellAmount: smartOrderSellAmount,
      buyAmount: ethers.utils.parseEther("0.75"),
      feeAmount: ethers.utils.parseEther("0.05"),
      validTo: 0xffffffff,
      appData: await smartOrder.APPDATA(),
      sellTokenBalance: OrderBalance.ERC20,
      buyTokenBalance: OrderBalance.ERC20,
    });

    await encoder.encodeTrade(smartOrderTrade, {
      scheme: SigningScheme.EIP1271,
      data: {
        verifier: smartOrder.address,
        signature: ethers.utils.defaultAbiCoder.encode(
          ["uint256"],
          [smartOrderSellAmount],
        ),
      },
    });

    await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [tokens[0].address]: 10,
        [tokens[1].address]: 15,
      }),
    );

    expect(await tokens[0].balanceOf(traders[1].address)).to.deep.equal(
      ethers.utils.parseEther("0.75"),
    );
  });
});
