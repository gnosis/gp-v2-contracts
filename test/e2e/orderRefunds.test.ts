import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import Debug from "debug";
import { Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  computeOrderUid,
  domain,
  encodeOrderRefunds,
  hashOrder,
} from "../../src/ts";

import { deployTestContracts } from "./fixture";

const debug = Debug("e2e:orderRefunds");

describe("E2E: Expired Order Gas Refunds", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let traders: Wallet[];

  let settlement: Contract;
  let allowanceManager: Contract;
  let domainSeparator: TypedDataDomain;

  let owl: Contract;
  let dai: Contract;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      allowanceManager,
      wallets: [solver, ...traders],
    } = deployment);

    const { authenticator, owner } = deployment;
    await authenticator.connect(owner).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    owl = await waffle.deployContract(deployer, ERC20, ["OWL", 18]);
    dai = await waffle.deployContract(deployer, ERC20, ["DAI", 18]);
  });

  it("should claim a gas refund for expired orders", async () => {
    // Settle the same trvial batch between two overlapping trades twice:
    //
    //   /--(1. SELL 100 OWL for DAI if p(OWL/DAI) >= 1)---\
    //   |                                                 v
    // [DAI]                                             [OWL]
    //   ^                                                 |
    //   \--(2. BUY 100 OWL for DAI if p(OWL/DAI) <= 1.1)--/

    // NOTE: Mint extra tokens for all traders and the settlement contract to
    // ensure that things like un-zeroing or zeroing a balance affects the gas
    // results.
    for (const token of [owl, dai]) {
      await token.mint(settlement.address, ethers.utils.parseEther("1.0"));
      for (const trader of traders.slice(0, 2)) {
        await token.mint(trader.address, ethers.utils.parseEther("1000000.0"));
        await token
          .connect(trader)
          .approve(allowanceManager.address, ethers.constants.MaxUint256);
      }
    }

    const ORDER_VALIDITY = 60; // seconds
    const prepareBatch = async () => {
      const { timestamp } = await ethers.provider.getBlock("latest");
      const validTo = timestamp + ORDER_VALIDITY;

      const sellOrder = {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: owl.address,
        buyToken: dai.address,
        sellAmount: ethers.utils.parseEther("100.0"),
        buyAmount: ethers.utils.parseEther("100.0"),
        feeAmount: ethers.utils.parseEther("0.1"),
        validTo,
        appData: 1,
      };

      const buyOrder = {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        buyToken: owl.address,
        sellToken: dai.address,
        buyAmount: ethers.utils.parseEther("100.0"),
        sellAmount: ethers.utils.parseEther("110.0"),
        feeAmount: ethers.utils.parseEther("0.1"),
        validTo,
        appData: 2,
      };

      const encoder = new SettlementEncoder(domainSeparator);
      await encoder.signEncodeTrade(
        sellOrder,
        traders[0],
        SigningScheme.TYPED_DATA,
      );
      await encoder.signEncodeTrade(
        buyOrder,
        traders[1],
        SigningScheme.TYPED_DATA,
      );

      const orderUids = [
        computeOrderUid({
          orderDigest: hashOrder(sellOrder),
          owner: traders[0].address,
          validTo,
        }),
        computeOrderUid({
          orderDigest: hashOrder(buyOrder),
          owner: traders[1].address,
          validTo,
        }),
      ];

      return [encoder, orderUids] as const;
    };

    const [encoder1, orderUids] = await prepareBatch();
    const txWithoutRefunds = await settlement.connect(solver).settle(
      encoder1.tokens,
      encoder1.clearingPrices({
        [owl.address]: ethers.utils.parseEther("1.05"),
        [dai.address]: ethers.utils.parseEther("1.0"),
      }),
      encoder1.encodedTrades,
      encoder1.encodedInteractions,
      "0x",
    );
    const { gasUsed: gasUsedWithoutRefunds } = await txWithoutRefunds.wait();

    await ethers.provider.send("evm_increaseTime", [ORDER_VALIDITY + 1]);
    await ethers.provider.send("evm_mine", []);

    const [encoder2] = await prepareBatch();
    const txWithRefunds = await settlement.connect(solver).settle(
      encoder2.tokens,
      encoder2.clearingPrices({
        [owl.address]: ethers.utils.parseEther("1.05"),
        [dai.address]: ethers.utils.parseEther("1.0"),
      }),
      encoder2.encodedTrades,
      encoder2.encodedInteractions,
      encodeOrderRefunds(orderUids),
    );
    const { gasUsed: gasUsedWithRefunds } = await txWithRefunds.wait();

    const gasSavingsPerOrderRefund = gasUsedWithoutRefunds
      .sub(gasUsedWithRefunds)
      .div(orderUids.length);
    debug(`Gas savings per order: ${gasSavingsPerOrderRefund}`);

    expect(gasSavingsPerOrderRefund.gt(8000)).to.be.true;
  });
});
