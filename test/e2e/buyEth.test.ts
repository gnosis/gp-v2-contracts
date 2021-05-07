import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  BUY_ETH_ADDRESS,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";

import { deployTestContracts } from "./fixture";

describe("E2E: Buy Ether", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let traders: Wallet[];

  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let weth: Contract;
  let usdt: Contract;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      weth,
      settlement,
      vaultRelayer,
      wallets: [solver, ...traders],
    } = deployment);

    const { authenticator, manager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    usdt = await waffle.deployContract(deployer, ERC20, ["USDT", 6]);
  });

  it("should unwrap WETH for orders buying Ether", async () => {
    // Settle a trivial batch between two overlapping trades:
    //
    //   /----(1. SELL 1 WETH for USDT if p(WETH) >= 1100)----\
    //   |                                                    v
    // [USDT]                                              [(W)ETH]
    //   ^                                                    |
    //   \-----(2. BUY 1 ETH for USDT if p(WETH) <= 1200)-----/

    const encoder = new SettlementEncoder(domainSeparator);

    await weth
      .connect(traders[0])
      .deposit({ value: ethers.utils.parseEther("1.001") });
    await weth
      .connect(traders[0])
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: weth.address,
        buyToken: usdt.address,
        sellAmount: ethers.utils.parseEther("1.0"),
        buyAmount: ethers.utils.parseUnits("1100.0", 6),
        feeAmount: ethers.utils.parseEther("0.001"),
        validTo: 0xffffffff,
        appData: 1,
      },
      traders[0],
      SigningScheme.EIP712,
    );

    await usdt.mint(traders[1].address, ethers.utils.parseUnits("1201.2", 6));
    await usdt
      .connect(traders[1])
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        buyToken: BUY_ETH_ADDRESS,
        sellToken: usdt.address,
        buyAmount: ethers.utils.parseEther("1.0"),
        sellAmount: ethers.utils.parseUnits("1200.0", 6),
        feeAmount: ethers.utils.parseUnits("1.2", 6),
        validTo: 0xffffffff,
        appData: 2,
      },
      traders[1],
      SigningScheme.EIP712,
    );

    encoder.encodeInteraction({
      target: weth.address,
      callData: weth.interface.encodeFunctionData("withdraw", [
        ethers.utils.parseEther("1.0"),
      ]),
    });

    const trader1InitialBalance = await traders[1].getBalance();
    await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [weth.address]: ethers.utils.parseUnits("1150.0", 6),
        [BUY_ETH_ADDRESS]: ethers.utils.parseUnits("1150.0", 6),
        [usdt.address]: ethers.utils.parseEther("1.0"),
      }),
    );

    expect(await weth.balanceOf(settlement.address)).to.deep.equal(
      ethers.utils.parseEther("0.001"),
    );
    expect(await weth.balanceOf(traders[0].address)).to.deep.equal(
      ethers.constants.Zero,
    );
    expect(await traders[1].getBalance()).to.deep.equal(
      trader1InitialBalance.add(ethers.utils.parseEther("1.0")),
    );
  });
});
