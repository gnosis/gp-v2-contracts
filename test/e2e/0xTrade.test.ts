import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import Debug from "debug";
import { BigNumber, Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  Order,
  OrderKind,
  Prices,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";

import { deployTestContracts } from "./fixture";
import { SimpleOrder as ZeroExSimpleOrder } from "./zero-ex";
import * as ZeroExV2 from "./zero-ex/v2";

const debug = Debug("test:e2e:0xTrade");

describe("E2E: Can settle a 0x trade", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let trader: Wallet;
  let marketMaker: Wallet;

  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let owl: Contract;
  let gno: Contract;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      vaultRelayer,
      wallets: [solver, trader, marketMaker],
    } = deployment);

    const { authenticator, manager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    owl = await waffle.deployContract(deployer, ERC20, ["OWL", 18]);
    gno = await waffle.deployContract(deployer, ERC20, ["GNO", 18]);
  });

  function generateSettlementSolution(): {
    gpv2Order: Order;
    zeroExOrder: ZeroExSimpleOrder;
    zeroExTakerAmount: BigNumber;
    clearingPrices: Prices;
    gpv2OwlSurplus: BigNumber;
    zeroExOwlSurplus: BigNumber;
  } {
    const gpv2Order = {
      kind: OrderKind.BUY,
      partiallyFillable: false,
      buyToken: gno.address,
      sellToken: owl.address,
      buyAmount: ethers.utils.parseEther("1.0"),
      sellAmount: ethers.utils.parseEther("130.0"),
      feeAmount: ethers.utils.parseEther("10.0"),
      validTo: 0xffffffff,
      appData: 1,
    };

    const zeroExGnoPrice = 110;
    const zeroExOrder = {
      takerAddress: settlement.address,
      makerAssetAddress: gno.address,
      makerAssetAmount: ethers.utils.parseEther("1000.0"),
      takerAssetAddress: owl.address,
      takerAssetAmount: ethers.utils.parseEther("1000.0").mul(zeroExGnoPrice),
    };
    const zeroExTakerAmount = gpv2Order.buyAmount.mul(zeroExGnoPrice);

    const gpv2GnoPrice = 120;
    const clearingPrices = {
      [owl.address]: 1,
      [gno.address]: gpv2GnoPrice,
    };

    const gpv2OwlSurplus = gpv2Order.sellAmount.sub(
      gpv2Order.buyAmount.mul(gpv2GnoPrice),
    );
    const zeroExOwlSurplus = gpv2Order.buyAmount.mul(
      gpv2GnoPrice - zeroExGnoPrice,
    );

    return {
      gpv2Order,
      zeroExOrder,
      zeroExTakerAmount,
      clearingPrices,
      gpv2OwlSurplus,
      zeroExOwlSurplus,
    };
  }

  describe("0x Protocol v2", () => {
    it("should settle an EOA trade with a 0x trade", async () => {
      // Settles a market order buying 1 GNO for 120 OWL and get matched with a
      // market maker using 0x orders.

      const {
        gpv2Order,
        zeroExOrder,
        zeroExTakerAmount,
        clearingPrices,
        gpv2OwlSurplus,
        zeroExOwlSurplus,
      } = generateSettlementSolution();

      await owl.mint(trader.address, ethers.utils.parseEther("140"));
      await owl
        .connect(trader)
        .approve(vaultRelayer.address, ethers.constants.MaxUint256);

      const zeroEx = await ZeroExV2.deployExchange(deployer);

      await gno.mint(marketMaker.address, ethers.utils.parseEther("1000.0"));
      await gno
        .connect(marketMaker)
        .approve(zeroEx.erc20Proxy.address, ethers.constants.MaxUint256);

      const zeroExSignedOrder = await ZeroExV2.signSimpleOrder(
        marketMaker,
        zeroEx.domainSeparator,
        zeroExOrder,
      );
      expect(
        await zeroEx.exchange.isValidSignature(
          zeroExSignedOrder.hash,
          marketMaker.address,
          zeroExSignedOrder.signature,
        ),
      ).to.be.true;

      const encoder = new SettlementEncoder(domainSeparator);
      await encoder.signEncodeTrade(gpv2Order, trader, SigningScheme.EIP712);
      encoder.encodeInteraction({
        target: owl.address,
        callData: owl.interface.encodeFunctionData("approve", [
          zeroEx.erc20Proxy.address,
          zeroExTakerAmount,
        ]),
      });
      encoder.encodeInteraction({
        target: zeroEx.exchange.address,
        callData: zeroEx.exchange.interface.encodeFunctionData("fillOrder", [
          zeroExSignedOrder.order,
          zeroExTakerAmount,
          zeroExSignedOrder.signature,
        ]),
      });

      const tx = await settlement
        .connect(solver)
        .settle(...encoder.encodedSettlement(clearingPrices));

      const { gasUsed } = await tx.wait();
      debug(`gas used: ${gasUsed}`);

      expect(await gno.balanceOf(trader.address)).to.deep.equal(
        ethers.utils.parseEther("1.0"),
      );
      expect(await gno.balanceOf(marketMaker.address)).to.deep.equal(
        ethers.utils.parseEther("999.0"),
      );

      // NOTE: The user keeps the surplus from their trade.
      expect(await owl.balanceOf(trader.address)).to.deep.equal(gpv2OwlSurplus);
      // NOTE: The exchange keeps the surplus from the 0x order.
      expect(await owl.balanceOf(settlement.address)).to.deep.equal(
        zeroExOwlSurplus.add(gpv2Order.feeAmount),
      );
    });
  });
});
