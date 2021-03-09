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
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let weth: Contract;
  let usdt: Contract;
  let uniswapPair: Contract;
  let isWethToken0: boolean;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      vaultRelayer,
      wallets: [solver, pooler, ...traders],
    } = deployment);

    const { authenticator, manager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    weth = await waffle.deployContract(deployer, ERC20, ["WETH", 18]);
    usdt = await waffle.deployContract(deployer, ERC20, ["USDT", 6]);

    const uniswapFactory = await waffle.deployContract(
      deployer,
      UniswapV2Factory,
      [deployer.address],
    );
    await uniswapFactory.createPair(weth.address, usdt.address);
    uniswapPair = new Contract(
      await uniswapFactory.getPair(weth.address, usdt.address),
      UniswapV2Pair.abi,
      deployer,
    );

    // NOTE: Which token ends up as token 0 or token 1 depends on the addresses
    // of the WETH and USDT token which can change depending on which order the
    // tests are run. Because of this, check the Uniswap pair to see which token
    // ended up on which index.
    isWethToken0 = (await uniswapPair.token0()) === weth.address;
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
    await weth.mint(uniswapPair.address, uniswapWethReserve);
    await usdt.mint(uniswapPair.address, uniswapUsdtReserve);
    await uniswapPair.mint(pooler.address);

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
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
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
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
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
        uniswapPair.address,
        uniswapWethInAmount,
      ]),
    });

    const [amount0Out, amount1Out] = isWethToken0
      ? [0, uniswapUsdtOutAmount]
      : [uniswapUsdtOutAmount, 0];
    encoder.encodeInteraction({
      target: uniswapPair.address,
      callData: uniswapPair.interface.encodeFunctionData("swap", [
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

    const [token0Reserve, token1Reserve] = await uniswapPair.getReserves();
    const [finalWethReserve, finalUsdtReserve] = isWethToken0
      ? [token0Reserve, token1Reserve]
      : [token1Reserve, token0Reserve];
    expect([finalWethReserve, finalUsdtReserve]).to.deep.equal([
      uniswapWethReserve.add(uniswapWethInAmount),
      uniswapUsdtReserve.sub(uniswapUsdtOutAmount),
    ]);
  });
});
