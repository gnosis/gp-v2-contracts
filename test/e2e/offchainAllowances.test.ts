import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { ethers } from "hardhat";

import {
  InteractionStage,
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

describe("E2E: Off-chain Allowances", () => {
  let manager: Wallet;
  let solver: Wallet;
  let traders: Wallet[];

  let vault: Contract;
  let vaultAuthorizer: Contract;
  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let eurs: [Contract, Contract];
  const ONE_EUR = ethers.utils.parseEther("1.0");

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      vault,
      vaultAuthorizer,
      settlement,
      vaultRelayer,
      manager,
      wallets: [solver, ...traders],
    } = deployment);

    const { authenticator } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    const ERC20 = await ethers.getContractFactory("ERC20PresetPermit");
    eurs = [await ERC20.deploy("EUR1"), await ERC20.deploy("EUR2")];
  });

  describe("EIP-2612 Permit", () => {
    it("permits trader allowance with settlement", async () => {
      // Settle a trivial trade where all € stable coins trade 1:1.

      const encoder = new SettlementEncoder(domainSeparator);

      await eurs[0].mint(traders[0].address, ONE_EUR);
      await eurs[0]
        .connect(traders[0])
        .approve(vaultRelayer.address, ethers.constants.MaxUint256);
      await encoder.signEncodeTrade(
        {
          kind: OrderKind.SELL,
          partiallyFillable: false,
          sellToken: eurs[0].address,
          buyToken: eurs[1].address,
          sellAmount: ONE_EUR,
          buyAmount: ONE_EUR,
          feeAmount: ethers.constants.Zero,
          validTo: 0xffffffff,
          appData: 1,
        },
        traders[0],
        SigningScheme.EIP712,
      );

      await eurs[1].mint(traders[1].address, ONE_EUR);

      const permit = {
        owner: traders[1].address,
        spender: vaultRelayer.address,
        value: ONE_EUR,
        nonce: await eurs[1].nonces(traders[1].address),
        deadline: 0xffffffff,
      };
      const { r, s, v } = ethers.utils.splitSignature(
        await traders[1]._signTypedData(
          {
            name: await eurs[1].name(),
            version: "1",
            chainId: domainSeparator.chainId,
            verifyingContract: eurs[1].address,
          },
          {
            Permit: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          permit,
        ),
      );
      encoder.encodeInteraction(
        {
          target: eurs[1].address,
          callData: eurs[1].interface.encodeFunctionData("permit", [
            permit.owner,
            permit.spender,
            permit.value,
            permit.deadline,
            v,
            r,
            s,
          ]),
        },
        InteractionStage.PRE,
      );

      await encoder.signEncodeTrade(
        {
          kind: OrderKind.BUY,
          partiallyFillable: false,
          buyToken: eurs[0].address,
          sellToken: eurs[1].address,
          buyAmount: ONE_EUR,
          sellAmount: ONE_EUR,
          feeAmount: ethers.constants.Zero,
          validTo: 0xffffffff,
          appData: 2,
        },
        traders[1],
        SigningScheme.EIP712,
      );

      await settlement.connect(solver).settle(
        ...encoder.encodedSettlement({
          [eurs[0].address]: 1,
          [eurs[1].address]: 1,
        }),
      );

      expect(await eurs[1].balanceOf(traders[1].address)).to.deep.equal(
        ethers.constants.Zero,
      );
    });
  });

  describe("Vault Allowance", () => {
    it("allows setting Vault relayer approval with interactions", async () => {
      // Settle a trivial trade where all € stable coins trade 1:1.

      const encoder = new SettlementEncoder(domainSeparator);

      await eurs[0].mint(traders[0].address, ONE_EUR);
      await eurs[0]
        .connect(traders[0])
        .approve(vaultRelayer.address, ethers.constants.MaxUint256);
      await encoder.signEncodeTrade(
        {
          kind: OrderKind.SELL,
          partiallyFillable: false,
          sellToken: eurs[0].address,
          buyToken: eurs[1].address,
          sellAmount: ONE_EUR,
          buyAmount: ONE_EUR,
          feeAmount: ethers.constants.Zero,
          validTo: 0xffffffff,
          appData: 1,
        },
        traders[0],
        SigningScheme.EIP712,
      );

      await eurs[1].mint(traders[1].address, ONE_EUR);
      await eurs[1]
        .connect(traders[1])
        .approve(vault.address, ethers.constants.MaxUint256);
      await vault.connect(traders[1]).manageUserBalance([
        {
          kind: UserBalanceOpKind.DEPOSIT_INTERNAL,
          asset: eurs[1].address,
          amount: ONE_EUR,
          sender: traders[1].address,
          recipient: traders[1].address,
        },
      ]);

      // The settlement contract needs to be authorized as a relayer to change
      // relayer allowances for users by signature.
      await vaultAuthorizer
        .connect(manager)
        .grantRole(
          ethers.utils.solidityKeccak256(
            ["uint256", "bytes4"],
            [vault.address, vault.interface.getSighash("setRelayerApproval")],
          ),
          settlement.address,
        );
      await grantRequiredRoles(
        vaultAuthorizer.connect(manager),
        vault.address,
        vaultRelayer.address,
      );

      const deadline = 0xffffffff;
      const { chainId } = await ethers.provider.getNetwork();
      const approval = vault.interface.encodeFunctionData(
        "setRelayerApproval",
        [traders[1].address, vaultRelayer.address, true],
      );
      const { v, r, s } = ethers.utils.splitSignature(
        await traders[1]._signTypedData(
          {
            name: "Balancer V2 Vault",
            version: "1",
            chainId,
            verifyingContract: vault.address,
          },
          {
            SetRelayerApproval: [
              { name: "calldata", type: "bytes" },
              { name: "sender", type: "address" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          {
            calldata: approval,
            sender: settlement.address,
            nonce: 0,
            deadline,
          },
        ),
      );
      encoder.encodeInteraction(
        {
          target: vault.address,
          callData: ethers.utils.hexConcat([
            approval,
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "uint8", "bytes32", "bytes32"],
              [deadline, v, r, s],
            ),
          ]),
        },
        InteractionStage.PRE,
      );

      await encoder.signEncodeTrade(
        {
          kind: OrderKind.BUY,
          partiallyFillable: false,
          buyToken: eurs[0].address,
          sellToken: eurs[1].address,
          buyAmount: ONE_EUR,
          sellAmount: ONE_EUR,
          feeAmount: ethers.constants.Zero,
          validTo: 0xffffffff,
          appData: 2,
          sellTokenBalance: OrderBalance.INTERNAL,
        },
        traders[1],
        SigningScheme.EIP712,
      );

      await settlement.connect(solver).settle(
        ...encoder.encodedSettlement({
          [eurs[0].address]: 1,
          [eurs[1].address]: 1,
        }),
      );

      expect(await eurs[1].balanceOf(traders[1].address)).to.deep.equal(
        ethers.constants.Zero,
      );
    });
  });
});
