import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import { BigNumber, Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  Order,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";
import { ceilDiv } from "../testHelpers";

import { deployTestContracts } from "./fixture";

describe("E2E: RetrETH Red Wine and Olive Oil Market", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let traders: Wallet[];

  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

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
  });

  it("should settle red wine and olive oil market", async () => {
    // Settlement for the RetrETH wine and olive oil market:
    //
    //  /---(6. BUY 10 🍷 with 💶 if p(🍷) <= 13)--> [🍷]
    //  |                                             |
    //  |                                             |
    // [💶]                        (1. SELL 12 🍷 for 🫒 if p(🍷) >= p(🫒))
    //  |^                                            |
    //  ||                                            |
    //  |\--(4. SELL 15 🫒 for 💶 if p(🫒) >= 12)--\  v
    //  \---(5. BUY 4 🫒 with 💶 if p(🫒) <= 13)---> [🫒]

    const STARTING_BALANCE = ethers.utils.parseEther("1000.0");
    const erc20 = (symbol: string) =>
      waffle.deployContract(deployer, ERC20, [symbol, 18]);

    const eur = await erc20("💶");
    const oil = await erc20("🫒");
    const wine = await erc20("🍷");

    const orderDefaults = {
      validTo: 0xffffffff,
      feeAmount: ethers.utils.parseEther("1.0"),
    };
    const encoder = new SettlementEncoder(domainSeparator);

    const addOrder = async (
      trader: Wallet,
      order: Order,
      executedAmount?: BigNumber,
    ) => {
      const sellToken = await ethers.getContractAt(
        ERC20.abi,
        order.sellToken,
        deployer,
      );
      await sellToken.mint(trader.address, STARTING_BALANCE);
      await sellToken
        .connect(trader)
        .approve(vaultRelayer.address, ethers.constants.MaxUint256);

      await encoder.signEncodeTrade(order, trader, SigningScheme.EIP712, {
        executedAmount,
      });
    };

    await addOrder(traders[0], {
      ...orderDefaults,
      kind: OrderKind.SELL,
      partiallyFillable: false,
      sellToken: wine.address,
      buyToken: oil.address,
      sellAmount: ethers.utils.parseEther("12.0"),
      buyAmount: ethers.utils.parseEther("12.0"),
      appData: 1,
    });

    await addOrder(traders[1], {
      ...orderDefaults,
      kind: OrderKind.SELL,
      partiallyFillable: false,
      sellToken: oil.address,
      buyToken: eur.address,
      sellAmount: ethers.utils.parseEther("15.0"),
      buyAmount: ethers.utils.parseEther("180.0"),
      appData: 4,
    });

    await addOrder(
      traders[2],
      {
        ...orderDefaults,
        kind: OrderKind.BUY,
        partiallyFillable: true,
        buyToken: oil.address,
        sellToken: eur.address,
        buyAmount: ethers.utils.parseEther("4.0"),
        sellAmount: ethers.utils.parseEther("52.0"),
        appData: 5,
      },
      ethers.utils.parseEther("27.0").div(13),
    );

    await addOrder(
      traders[3],
      {
        ...orderDefaults,
        kind: OrderKind.BUY,
        partiallyFillable: true,
        buyToken: wine.address,
        sellToken: eur.address,
        buyAmount: ethers.utils.parseEther("20.0"),
        sellAmount: ethers.utils.parseEther("280.0"),
        appData: 6,
      },
      ethers.utils.parseEther("12.0"),
    );

    await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [eur.address]: ethers.utils.parseEther("1.0"),
        [oil.address]: ethers.utils.parseEther("13.0"),
        [wine.address]: ethers.utils.parseEther("14.0"),
      }),
    );

    expect(await wine.balanceOf(traders[0].address)).to.deep.equal(
      STARTING_BALANCE.sub(ethers.utils.parseEther("12.0")).sub(
        orderDefaults.feeAmount,
      ),
    );
    expect(await oil.balanceOf(traders[0].address)).to.deep.equal(
      ceilDiv(ethers.utils.parseEther("12.0").mul(14), 13),
    );

    expect(await oil.balanceOf(traders[1].address)).to.deep.equal(
      STARTING_BALANCE.sub(ethers.utils.parseEther("15.0")).sub(
        orderDefaults.feeAmount,
      ),
    );
    expect(await eur.balanceOf(traders[1].address)).to.deep.equal(
      ethers.utils.parseEther("15.0").mul(13),
    );

    expect(await eur.balanceOf(traders[2].address)).to.deep.equal(
      STARTING_BALANCE.sub(ethers.utils.parseEther("27.0"))
        .sub(
          orderDefaults.feeAmount
            .mul(ethers.utils.parseEther("27.0").div(13))
            .div(ethers.utils.parseEther("4.0")),
        )
        // NOTE: Account for rounding error from computing sell amount that is
        // an order of magnitude larger than executed buy amount from the
        // settlement.
        .add(1),
    );
    expect(await oil.balanceOf(traders[2].address)).to.deep.equal(
      ethers.utils.parseEther("27.0").div(13),
    );

    expect(await eur.balanceOf(traders[3].address)).to.deep.equal(
      STARTING_BALANCE.sub(ethers.utils.parseEther("12.0").mul(14)).sub(
        orderDefaults.feeAmount
          .mul(ethers.utils.parseEther("12.0"))
          .div(ethers.utils.parseEther("20.0")),
      ),
    );
    expect(await wine.balanceOf(traders[3].address)).to.deep.equal(
      ethers.utils.parseEther("12.0"),
    );
  });
});
