import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  InteractionStage,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";

import { deployTestContracts } from "./fixture";

describe("E2E: Burn fees", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let traders: Wallet[];

  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let owl: Contract;
  let dai: Contract;

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

    owl = await waffle.deployContract(deployer, ERC20, ["OWL", "Owl token"]);
    dai = await waffle.deployContract(deployer, ERC20, ["DAI", "Dai token"]);
  });

  it("uses post-interation to burn settlement fees", async () => {
    // Settle a trivial 1:1 trade between DAI and OWL.

    const ONE_USD = ethers.utils.parseEther("1.0");

    const encoder = new SettlementEncoder(domainSeparator);

    await owl.mint(traders[0].address, ONE_USD.mul(1001));
    await owl
      .connect(traders[0])
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: owl.address,
        buyToken: dai.address,
        sellAmount: ONE_USD.mul(1000),
        buyAmount: ONE_USD.mul(1000),
        feeAmount: ONE_USD,
        validTo: 0xffffffff,
        appData: 1,
      },
      traders[0],
      SigningScheme.EIP712,
    );

    await dai.mint(traders[1].address, ONE_USD.mul(1000));
    await dai
      .connect(traders[1])
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);

    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        buyToken: owl.address,
        sellToken: dai.address,
        buyAmount: ONE_USD.mul(1000),
        sellAmount: ONE_USD.mul(1000),
        feeAmount: ethers.constants.Zero,
        validTo: 0xffffffff,
        appData: 2,
      },
      traders[1],
      SigningScheme.EIP712,
    );

    encoder.encodeInteraction(
      {
        target: owl.address,
        callData: owl.interface.encodeFunctionData("burn", [ONE_USD]),
      },
      InteractionStage.POST,
    );

    const tx = settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [owl.address]: 1,
        [dai.address]: 1,
      }),
    );

    await expect(tx)
      .to.emit(owl, "Transfer")
      .withArgs(settlement.address, ethers.constants.AddressZero, ONE_USD);
    expect(await dai.balanceOf(settlement.address)).to.deep.equal(
      ethers.constants.Zero,
    );
  });
});
