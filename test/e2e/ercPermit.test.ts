import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { ethers } from "hardhat";

import {
  InteractionStage,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";

import { deployTestContracts } from "./fixture";

describe("E2E: EIP-2612 Permit", () => {
  let solver: Wallet;
  let traders: Wallet[];

  let vault: Contract;
  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let eurs: [Contract, Contract];

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
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
            vault.interface.getSighash("transferToExternalBalance"),
          ],
        ),
        vaultRelayer.address,
      );
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    const ERC20Permit = await ethers.getContractFactory("ERC20Permit");
    eurs = [await ERC20Permit.deploy("EUR1"), await ERC20Permit.deploy("EUR2")];
  });

  it("permits trader allowance with settlement", async () => {
    // Settle a trivial where all € stable coins trade 1:1.

    const ONE_EUR = ethers.utils.parseEther("1.0");

    const encoder = new SettlementEncoder(domainSeparator);

    await eurs[0].mint(traders[0].address, ONE_EUR);
    await eurs[0]
      .connect(traders[0])
      .approve(vault.address, ethers.constants.MaxUint256);
    await vault
      .connect(traders[0])
      .changeRelayerAllowance(vaultRelayer.address, true);
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
      spender: vault.address,
      value: ONE_EUR,
      nonce: await eurs[1].nonces(traders[1].address),
      deadline: 0xffffffff,
    };
    const { r, s, v } = ethers.utils.splitSignature(
      await traders[1]._signTypedData(
        {
          name: await eurs[1].name(),
          verifyingContract: eurs[1].address,
        },
        {
          Permit: [
            {
              name: "owner",
              type: "address",
            },
            {
              name: "spender",
              type: "address",
            },
            {
              name: "value",
              type: "uint256",
            },
            {
              name: "nonce",
              type: "uint256",
            },
            {
              name: "deadline",
              type: "uint256",
            },
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

    // NOTE: At the moment it isn't possible to set vault relayer approval by
    // offline signature, although it may be added in the future.
    await vault
      .connect(traders[1])
      .changeRelayerAllowance(vaultRelayer.address, true);

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
