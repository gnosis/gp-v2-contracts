import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import UniswapV2Router from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
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

import { deployTestContracts } from "./fixture";

describe("E2E: Should Perform Single Order Settlements With Uniswap", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let pooler: Wallet;
  let trader: Wallet;
  let receiver: Wallet;

  let settlement: Contract;
  let allowanceManager: Contract;
  let domainSeparator: TypedDataDomain;

  let weth: Contract;
  let usdt: Contract;

  const uniswapWethReserve = ethers.utils.parseEther("1000.0");
  const uniswapUsdtReserve = ethers.utils.parseUnits("1700000.0", 6);
  let uniswapPair: Contract;
  let uniswapRouter: Contract;
  let isWethToken0: boolean;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      allowanceManager,
      wallets: [solver, pooler, trader, receiver],
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

    const uniswapWethReserve = ethers.utils.parseEther("1000.0");
    const uniswapUsdtReserve = ethers.utils.parseUnits("1700000.0", 6);
    await weth.mint(uniswapPair.address, uniswapWethReserve);
    await usdt.mint(uniswapPair.address, uniswapUsdtReserve);
    await uniswapPair.mint(pooler.address);

    uniswapRouter = await waffle.deployContract(deployer, UniswapV2Router, [
      uniswapFactory.address,
      weth.address,
    ]);

    // NOTE: Which token ends up as token 0 or token 1 depends on the addresses
    // of the WETH and USDT token which can change depending on which order the
    // tests are run. Because of this, check the Uniswap pair to see which token
    // ended up on which index.
    isWethToken0 = (await uniswapPair.token0()) === weth.address;
  });

  const computeUniswapSettlement = async (order: Order) => {
    // Settles a single order against Uniswap using the "fast-path".

    const transfers = [
      {
        target: uniswapPair.address,
        amount: order.sellAmount,
      },
    ];
    if (BigNumber.from(order.feeAmount).gt(0)) {
      transfers.push({
        target: settlement.address,
        amount: order.feeAmount,
      });
    }

    // NOTE: Use Uniswap router as a price oracle. In theory, computing this
    // amount can be implemented on-chain by making a "light-weight" router
    // that assumes that the "in amounts" have already been transfered to the
    // pair.
    const [
      ,
      uniswapUsdtOutAmount,
    ] = await uniswapRouter.getAmountsOut(order.sellAmount, [
      weth.address,
      usdt.address,
    ]);

    const [amount0Out, amount1Out] = isWethToken0
      ? [0, uniswapUsdtOutAmount]
      : [uniswapUsdtOutAmount, 0];
    const interactions = [
      {
        target: uniswapPair.address,
        value: 0,
        callData: uniswapPair.interface.encodeFunctionData("swap", [
          amount0Out,
          amount1Out,
          order.receiver ?? trader.address,
          "0x",
        ]),
      },
    ];

    return {
      uniswapUsdtOutAmount,
      transfers,
      interactions,
    };
  };

  it("performs 'fast-path' single order swap", async () => {
    await weth.mint(trader.address, ethers.utils.parseEther("1.01"));
    await weth
      .connect(trader)
      .approve(allowanceManager.address, ethers.constants.MaxUint256);

    const order = {
      kind: OrderKind.SELL,
      partiallyFillable: false,
      sellToken: weth.address,
      buyToken: usdt.address,
      sellAmount: ethers.utils.parseEther("1.0"),
      buyAmount: ethers.utils.parseUnits("1500.0", 6),
      feeAmount: ethers.utils.parseEther("0.01"),
      validTo: 0xffffffff,
      appData: 1,
    };

    const {
      uniswapUsdtOutAmount,
      transfers,
      interactions,
    } = await computeUniswapSettlement(order);

    const encoder = new SettlementEncoder(domainSeparator);
    await encoder.signEncodeTrade(order, trader, SigningScheme.EIP712);
    for (const interaction of interactions) {
      encoder.encodeInteraction(interaction);
    }

    await settlement
      .connect(solver)
      .settleSingleTrade(...encoder.encodeSingleTradeSettlement(transfers));

    expect(await weth.balanceOf(settlement.address)).to.equal(order.feeAmount);
    expect(await usdt.balanceOf(settlement.address)).to.equal(
      ethers.constants.Zero,
    );

    expect(await weth.balanceOf(trader.address)).to.equal(
      ethers.constants.Zero,
    );
    expect(await usdt.balanceOf(trader.address)).to.equal(uniswapUsdtOutAmount);

    const [token0Reserve, token1Reserve] = await uniswapPair.getReserves();
    const [finalWethReserve, finalUsdtReserve] = isWethToken0
      ? [token0Reserve, token1Reserve]
      : [token1Reserve, token0Reserve];
    expect([finalWethReserve, finalUsdtReserve]).to.deep.equal([
      uniswapWethReserve.add(order.sellAmount),
      uniswapUsdtReserve.sub(uniswapUsdtOutAmount),
    ]);
  });

  it("should transfer to receiver when specified", async () => {
    await weth.mint(trader.address, ethers.utils.parseEther("1.0"));
    await weth
      .connect(trader)
      .approve(allowanceManager.address, ethers.constants.MaxUint256);

    const order = {
      kind: OrderKind.SELL,
      partiallyFillable: false,
      sellToken: weth.address,
      buyToken: usdt.address,
      receiver: receiver.address,
      sellAmount: ethers.utils.parseEther("1.0"),
      buyAmount: ethers.utils.parseUnits("1500.0", 6),
      feeAmount: ethers.constants.Zero,
      validTo: 0xffffffff,
      appData: 1,
    };

    const {
      uniswapUsdtOutAmount,
      transfers,
      interactions,
    } = await computeUniswapSettlement(order);

    const encoder = new SettlementEncoder(domainSeparator);
    await encoder.signEncodeTrade(order, trader, SigningScheme.EIP712);
    for (const interaction of interactions) {
      encoder.encodeInteraction(interaction);
    }

    await settlement
      .connect(solver)
      .settleSingleTrade(...encoder.encodeSingleTradeSettlement(transfers));

    expect(await usdt.balanceOf(trader.address)).to.deep.equal(
      ethers.constants.Zero,
    );
    expect(await usdt.balanceOf(receiver.address)).to.deep.equal(
      uniswapUsdtOutAmount,
    );
  });
});
