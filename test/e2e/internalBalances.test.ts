import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";

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
    await vaultAuthorizer
      .connect(manager)
      .grantRole(
        ethers.utils.solidityKeccak256(
          ["address", "bytes4"],
          [
            vault.address,
            vault.interface.getSighash("withdrawFromInternalBalance"),
          ],
        ),
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
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
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
        useInternalBuyTokenBalance: true,
      },
      traders[0],
      SigningScheme.EIP712,
    );

    await tokens[1].mint(traders[1].address, ethers.utils.parseEther("600.6"));
    await tokens[1]
      .connect(traders[1])
      .approve(vault.address, ethers.constants.MaxUint256);
    await vault.connect(traders[1]).depositToInternalBalance([
      {
        token: tokens[1].address,
        amount: ethers.utils.parseEther("600.6"),
        sender: traders[1].address,
        recipient: traders[1].address,
      },
    ]);
    await vault
      .connect(traders[1])
      .changeRelayerAllowance(vaultRelayer.address, true);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        buyToken: tokens[0].address,
        sellToken: tokens[1].address,
        buyAmount: ethers.utils.parseEther("1.0"),
        sellAmount: ethers.utils.parseEther("600.0"),
        feeAmount: ethers.utils.parseEther("0.6"),
        validTo: 0xffffffff,
        appData: 2,
        useInternalSellTokenBalance: true,
      },
      traders[1],
      SigningScheme.EIP712,
    );

    await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [tokens[0].address]: 550,
        [tokens[1].address]: 1,
      }),
    );

    expect(
      await vault.getInternalBalance(traders[0].address, [tokens[1].address]),
    ).to.deep.equal([ethers.utils.parseEther("550")]);
    expect(await tokens[0].balanceOf(traders[1].address)).to.equal(
      ethers.utils.parseEther("1.0"),
    );

    expect(await tokens[0].balanceOf(settlement.address)).to.equal(
      ethers.utils.parseEther("0.001"),
    );
    expect(await tokens[1].balanceOf(settlement.address)).to.equal(
      ethers.utils.parseEther("0.6"),
    );
  });
});
