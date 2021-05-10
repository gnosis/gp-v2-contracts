import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  OrderBalance,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
  grantRequiredRoles,
} from "../../src/ts";
import { UserBalanceOpKind } from "../balancer";

import { deployTestContracts } from "./fixture";

describe("E2E: Should allow trading with Vault internal balances", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let traders: Wallet[];

  let vault: Contract;
  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let tokens: [Contract, Contract];

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      vault,
      settlement,
      vaultRelayer,
      wallets: [solver, ...traders],
    } = deployment);

    const { vaultAuthorizer, authenticator, manager } = deployment;
    await grantRequiredRoles(
      vaultAuthorizer.connect(manager),
      vault.address,
      vaultRelayer.address,
    );
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    tokens = [
      await waffle.deployContract(deployer, ERC20, ["T0", 18]),
      await waffle.deployContract(deployer, ERC20, ["T1", 18]),
    ];

    await settlement.connect(solver).settle(
      ...SettlementEncoder.encodedSetup(
        ...tokens.map((token) => ({
          target: token.address,
          callData: token.interface.encodeFunctionData("approve", [
            vault.address,
            ethers.constants.MaxUint256,
          ]),
        })),
      ),
    );
  });

  it("should settle orders buying and selling with internal balances", async () => {
    const encoder = new SettlementEncoder(domainSeparator);

    await tokens[0].mint(traders[0].address, ethers.utils.parseEther("1.001"));
    await tokens[0]
      .connect(traders[0])
      .approve(vault.address, ethers.constants.MaxUint256);
    await vault
      .connect(traders[0])
      .setRelayerApproval(traders[0].address, vaultRelayer.address, true);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: tokens[0].address,
        buyToken: tokens[1].address,
        sellAmount: ethers.utils.parseEther("1.0"),
        buyAmount: ethers.utils.parseEther("500.0"),
        feeAmount: ethers.utils.parseEther("0.001"),
        validTo: 0xffffffff,
        appData: 1,
        sellTokenBalance: OrderBalance.EXTERNAL,
      },
      traders[0],
      SigningScheme.EIP712,
    );

    await tokens[1].mint(traders[1].address, ethers.utils.parseEther("300.3"));
    await tokens[1]
      .connect(traders[1])
      .approve(vault.address, ethers.constants.MaxUint256);
    await vault.connect(traders[1]).manageUserBalance([
      {
        kind: UserBalanceOpKind.DEPOSIT_INTERNAL,
        asset: tokens[1].address,
        amount: ethers.utils.parseEther("300.3"),
        sender: traders[1].address,
        recipient: traders[1].address,
      },
    ]);
    await vault
      .connect(traders[1])
      .setRelayerApproval(traders[1].address, vaultRelayer.address, true);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        buyToken: tokens[0].address,
        sellToken: tokens[1].address,
        buyAmount: ethers.utils.parseEther("0.5"),
        sellAmount: ethers.utils.parseEther("300.0"),
        feeAmount: ethers.utils.parseEther("0.3"),
        validTo: 0xffffffff,
        appData: 2,
        sellTokenBalance: OrderBalance.INTERNAL,
      },
      traders[1],
      SigningScheme.EIP712,
    );

    await tokens[0].mint(traders[2].address, ethers.utils.parseEther("2.002"));
    await tokens[0]
      .connect(traders[2])
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: tokens[0].address,
        buyToken: tokens[1].address,
        sellAmount: ethers.utils.parseEther("2.0"),
        buyAmount: ethers.utils.parseEther("1000.0"),
        feeAmount: ethers.utils.parseEther("0.002"),
        validTo: 0xffffffff,
        appData: 2,
        buyTokenBalance: OrderBalance.INTERNAL,
      },
      traders[2],
      SigningScheme.EIP712,
    );

    await tokens[1].mint(traders[3].address, ethers.utils.parseEther("1501.5"));
    await tokens[1]
      .connect(traders[3])
      .approve(vault.address, ethers.constants.MaxUint256);
    await vault.connect(traders[3]).manageUserBalance([
      {
        kind: UserBalanceOpKind.DEPOSIT_INTERNAL,
        asset: tokens[1].address,
        amount: ethers.utils.parseEther("1501.5"),
        sender: traders[3].address,
        recipient: traders[3].address,
      },
    ]);
    await vault
      .connect(traders[3])
      .setRelayerApproval(traders[3].address, vaultRelayer.address, true);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        buyToken: tokens[0].address,
        sellToken: tokens[1].address,
        buyAmount: ethers.utils.parseEther("2.5"),
        sellAmount: ethers.utils.parseEther("1500.0"),
        feeAmount: ethers.utils.parseEther("1.5"),
        validTo: 0xffffffff,
        appData: 2,
        sellTokenBalance: OrderBalance.INTERNAL,
        buyTokenBalance: OrderBalance.INTERNAL,
      },
      traders[3],
      SigningScheme.EIP712,
    );

    await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [tokens[0].address]: 550,
        [tokens[1].address]: 1,
      }),
    );

    expect(await tokens[1].balanceOf(traders[0].address)).to.equal(
      ethers.utils.parseEther("550.0"),
    );
    expect(await tokens[0].balanceOf(traders[1].address)).to.equal(
      ethers.utils.parseEther("0.5"),
    );
    expect(
      await vault.getInternalBalance(traders[2].address, [tokens[1].address]),
    ).to.deep.equal([ethers.utils.parseEther("1100")]);
    expect(
      await vault.getInternalBalance(traders[3].address, [tokens[0].address]),
    ).to.deep.equal([ethers.utils.parseEther("2.5")]);

    expect(await tokens[0].balanceOf(settlement.address)).to.equal(
      ethers.utils.parseEther("0.003"),
    );
    expect(await tokens[1].balanceOf(settlement.address)).to.equal(
      ethers.utils.parseEther("1.8"),
    );
  });
});
