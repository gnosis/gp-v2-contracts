import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { ethers } from "hardhat";

import {
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";

import { deployTestContracts } from "./fixture";

describe("E2E: Non-Standard ERC20 Tokens", () => {
  let solver: Wallet;
  let traders: Wallet[];

  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let tokens: [Contract, Contract];

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      settlement,
      vaultRelayer,
      wallets: [solver, ...traders],
    } = deployment);

    const { authenticator, manager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    const ERC20NoReturn = await ethers.getContractFactory("ERC20NoReturn");
    const ERC20ReturningUint = await ethers.getContractFactory(
      "ERC20ReturningUint",
    );
    tokens = [await ERC20NoReturn.deploy(), await ERC20ReturningUint.deploy()];
  });

  it("should allow trading non-standard ERC20 tokens", async () => {
    // Just trade 1:1

    const encoder = new SettlementEncoder(domainSeparator);
    const amount = ethers.utils.parseEther("1.0");
    const feeAmount = ethers.utils.parseEther("0.01");

    await tokens[0].mint(traders[0].address, amount.add(feeAmount));
    await tokens[0]
      .connect(traders[0])
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: tokens[0].address,
        buyToken: tokens[1].address,
        sellAmount: amount,
        buyAmount: amount,
        feeAmount,
        validTo: 0xffffffff,
        appData: 1,
      },
      traders[0],
      SigningScheme.EIP712,
    );

    await tokens[1].mint(traders[1].address, amount.add(feeAmount));
    await tokens[1]
      .connect(traders[1])
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        sellToken: tokens[1].address,
        buyToken: tokens[0].address,
        buyAmount: amount,
        sellAmount: amount,
        feeAmount,
        validTo: 0xffffffff,
        appData: 2,
      },
      traders[1],
      SigningScheme.EIP712,
    );

    await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [tokens[0].address]: 1,
        [tokens[1].address]: 1,
      }),
    );

    expect(await tokens[0].balanceOf(settlement.address)).to.equal(feeAmount);
    expect(await tokens[0].balanceOf(traders[1].address)).to.equal(amount);

    expect(await tokens[1].balanceOf(settlement.address)).to.equal(feeAmount);
    expect(await tokens[1].balanceOf(traders[0].address)).to.equal(amount);
  });
});
