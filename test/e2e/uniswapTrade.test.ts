import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
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

describe("E2E: Should Trade Surplus With Uniswap", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let pooler: Wallet;
  let traders: Wallet[];

  let settlement: Contract;
  let allowanceManager: Contract;
  let domainSeparator: TypedDataDomain;

  let weth: Contract;
  let usdt: Contract;
  let dai: Contract;

  let wethUsdtPair: Contract;
  let wethDaiPair: Contract;

  let uniswapRouter: Contract;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      allowanceManager,
      wallets: [solver, pooler, ...traders],
    } = deployment);

    const { authenticator, manager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    weth = await waffle.deployContract(deployer, ERC20, ["WETH", 18]);
    usdt = await waffle.deployContract(deployer, ERC20, ["USDT", 6]);
    dai = await waffle.deployContract(deployer, ERC20, ["DAI", 18]);

    const uniswapFactory = await waffle.deployContract(
      deployer,
      UniswapV2Factory,
      [deployer.address],
    );
    await uniswapFactory.createPair(weth.address, usdt.address);
    wethUsdtPair = new Contract(
      await uniswapFactory.getPair(weth.address, usdt.address),
      UniswapV2Pair.abi,
      deployer,
    );
    await uniswapFactory.createPair(weth.address, dai.address);
    wethDaiPair = new Contract(
      await uniswapFactory.getPair(weth.address, dai.address),
      UniswapV2Pair.abi,
      deployer,
    );

    const GPv2UniswapRouter = await ethers.getContractFactory(
      "GPv2UniswapRouter",
    );
    uniswapRouter = await GPv2UniswapRouter.deploy(
      settlement.address,
      uniswapFactory.address,
    );
    await authenticator.connect(manager).addSolver(uniswapRouter.address);
  });

  it("should settle two overlapping orders and trade surplus with Uniswap", async () => {
    // Settles the following batch:
    //
    //   /----(1. SELL 1 WETH for USDT if p(WETH) >= 500)-----\
    //   |                                                    |
    //   |                                                    v
    // [USDT]<---(Uniswap Pair 1000 WETH / 600.000 USDT)--->[WETH]
    //   ^                                                    |
    //   |                                                    |
    //   \----(2. BUY 0.5 WETH for USDT if p(WETH) <= 600)----/

    const uniswapWethReserve = ethers.utils.parseEther("1000.0");
    const uniswapUsdtReserve = ethers.utils.parseUnits("600000.0", 6);
    await weth.mint(wethUsdtPair.address, uniswapWethReserve);
    await usdt.mint(wethUsdtPair.address, uniswapUsdtReserve);
    await wethUsdtPair.mint(pooler.address);

    // The current batch has a sell order selling 1 WETH and a buy order buying
    // 0.5 WETH. This means there is exactly a surplus 0.5 WETH that needs to be
    // sold to Uniswap. Uniswap is governed by a balancing equation which can be
    // used to compute the exact buy amount for selling the 0.5 WETH and we can
    // use to build our the settlement with a smart contract interaction.
    // ```
    // (reserveWETH + inWETH * 0.997) * (reserveUSDT - outUSDT) = reserveWETH * reserveUSDT
    // outUSDT = (reserveUSDT * inWETH * 0.997) / (reserveWETH + inWETH * 0.997)
    //         = (reserveUSDT * inWETH * 997) / (reserveWETH * 1000 + inWETH * 997)
    // ```
    const uniswapWethInAmount = ethers.utils.parseEther("0.5");
    const uniswapUsdtOutAmount = uniswapUsdtReserve
      .mul(uniswapWethInAmount)
      .mul(997)
      .div(uniswapWethReserve.mul(1000).add(uniswapWethInAmount.mul(997)));

    const encoder = new SettlementEncoder(domainSeparator);

    await weth.mint(traders[0].address, ethers.utils.parseEther("1.001"));
    await weth
      .connect(traders[0])
      .approve(allowanceManager.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: weth.address,
        buyToken: usdt.address,
        sellAmount: ethers.utils.parseEther("1.0"),
        buyAmount: ethers.utils.parseUnits("500.0", 6),
        feeAmount: ethers.utils.parseEther("0.001"),
        validTo: 0xffffffff,
        appData: 1,
      },
      traders[0],
      SigningScheme.EIP712,
    );

    await usdt.mint(traders[1].address, ethers.utils.parseUnits("300.3", 6));
    await usdt
      .connect(traders[1])
      .approve(allowanceManager.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        buyToken: weth.address,
        sellToken: usdt.address,
        buyAmount: ethers.utils.parseEther("0.5"),
        sellAmount: ethers.utils.parseUnits("300.0", 6),
        feeAmount: ethers.utils.parseUnits("0.3", 6),
        validTo: 0xffffffff,
        appData: 2,
      },
      traders[1],
      SigningScheme.EIP712,
    );

    encoder.encodeInteraction({
      target: weth.address,
      callData: weth.interface.encodeFunctionData("transfer", [
        wethUsdtPair.address,
        uniswapWethInAmount,
      ]),
    });

    const isWethToken0 = (await wethUsdtPair.token0()) === weth.address;
    const [amount0Out, amount1Out] = isWethToken0
      ? [0, uniswapUsdtOutAmount]
      : [uniswapUsdtOutAmount, 0];
    encoder.encodeInteraction({
      target: wethUsdtPair.address,
      callData: wethUsdtPair.interface.encodeFunctionData("swap", [
        amount0Out,
        amount1Out,
        settlement.address,
        "0x",
      ]),
    });

    await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [weth.address]: uniswapUsdtOutAmount,
        [usdt.address]: uniswapWethInAmount,
      }),
    );

    expect(await weth.balanceOf(settlement.address)).to.deep.equal(
      ethers.utils.parseEther("0.001"),
    );
    expect(await usdt.balanceOf(settlement.address)).to.deep.equal(
      ethers.utils.parseUnits("0.3", 6),
    );

    expect(await weth.balanceOf(traders[0].address)).to.deep.equal(
      ethers.constants.Zero,
    );
    expect(await usdt.balanceOf(traders[0].address)).to.deep.equal(
      uniswapUsdtOutAmount.mul(2),
    );

    expect(await weth.balanceOf(traders[1].address)).to.deep.equal(
      ethers.utils.parseEther("0.5"),
    );
    expect(await usdt.balanceOf(traders[1].address)).to.deep.equal(
      ethers.utils
        .parseUnits("300.3", 6)
        .sub(uniswapUsdtOutAmount.add(ethers.utils.parseUnits("0.3", 6))),
    );

    const [token0Reserve, token1Reserve] = await wethUsdtPair.getReserves();
    const [finalWethReserve, finalUsdtReserve] = isWethToken0
      ? [token0Reserve, token1Reserve]
      : [token1Reserve, token0Reserve];
    expect([finalWethReserve, finalUsdtReserve]).to.deep.equal([
      uniswapWethReserve.add(uniswapWethInAmount),
      uniswapUsdtReserve.sub(uniswapUsdtOutAmount),
    ]);
  });

  it("executes a multi-hop swap for a sell order on behalf of the user", async () => {
    await weth.mint(wethUsdtPair.address, ethers.utils.parseEther("1000.0"));
    await usdt.mint(
      wethUsdtPair.address,
      ethers.utils.parseUnits("1750000.0", 6),
    );
    await wethUsdtPair.mint(pooler.address);

    await weth.mint(wethDaiPair.address, ethers.utils.parseEther("1000.0"));
    await dai.mint(wethDaiPair.address, ethers.utils.parseEther("1700000.0"));
    await wethDaiPair.mint(pooler.address);

    const buyAmount = ethers.utils.parseUnits("800.0", 6);
    const encoder = new SettlementEncoder(domainSeparator);

    await dai.mint(traders[0].address, ethers.utils.parseEther("1001.0"));
    await dai
      .connect(traders[0])
      .approve(allowanceManager.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: dai.address,
        buyToken: usdt.address,
        sellAmount: ethers.utils.parseEther("1000.0"),
        buyAmount,
        feeAmount: ethers.utils.parseEther("1.0"),
        validTo: 0xffffffff,
        appData: 1,
      },
      traders[0],
      SigningScheme.EIP712,
    );

    await uniswapRouter.settleSwap(
      [dai.address, weth.address, usdt.address],
      {
        ...encoder.trades[0],
        sellTokenIndex: 0,
        buyTokenIndex: 2,
      },
      buyAmount,
    );

    // NOTE: Check that there is a surplus, that is they received more than they
    // asked for.
    expect(buyAmount.lt(await usdt.balanceOf(traders[0].address))).to.be.true;
  });

  it("executes a multi-hop swap for a buy order on behalf of the user", async () => {
    await weth.mint(wethUsdtPair.address, ethers.utils.parseEther("1000.0"));
    await usdt.mint(
      wethUsdtPair.address,
      ethers.utils.parseUnits("1750000.0", 6),
    );
    await wethUsdtPair.mint(pooler.address);

    await weth.mint(wethDaiPair.address, ethers.utils.parseEther("1000.0"));
    await dai.mint(wethDaiPair.address, ethers.utils.parseEther("1700000.0"));
    await wethDaiPair.mint(pooler.address);

    const sellAmount = ethers.utils.parseEther("1200.0");
    const feeAmount = ethers.utils.parseEther("1.0");
    const encoder = new SettlementEncoder(domainSeparator);

    // NOTE: Mint exactly enough to fill the order at the limit price.
    await dai.mint(traders[0].address, sellAmount.add(feeAmount));
    expect(await dai.balanceOf(traders[0].address)).to.equal(
      sellAmount.add(feeAmount),
    );

    await dai
      .connect(traders[0])
      .approve(allowanceManager.address, ethers.constants.MaxUint256);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        partiallyFillable: false,
        sellToken: dai.address,
        buyToken: usdt.address,
        sellAmount,
        buyAmount: ethers.utils.parseUnits("1000.0", 6),
        feeAmount,
        validTo: 0xffffffff,
        appData: 1,
      },
      traders[0],
      SigningScheme.EIP712,
    );

    await uniswapRouter.settleSwap(
      [dai.address, weth.address, usdt.address],
      {
        ...encoder.trades[0],
        sellTokenIndex: 0,
        buyTokenIndex: 2,
      },
      sellAmount,
    );

    // NOTE: Check that there is a surplus, that is they paid less than their
    // maximum sell amount.
    expect(await dai.balanceOf(traders[0].address)).to.not.equal(
      ethers.constants.Zero,
    );
  });
});
