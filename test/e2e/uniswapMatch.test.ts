import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import { SigningScheme, domain, signOrder } from "../../src/ts";

import { deployTestContracts } from "./fixture";
import { UniswapMatch } from "./uniswap_match";

describe("E2E: single trade matched directly with Uniswap", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let pooler: Wallet;
  let user: Wallet;

  let settlement: Contract;
  let allowanceManager: Contract;

  let weth: Contract;
  let usdc: Contract;
  let uniswapFactory: Contract;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      allowanceManager,
      wallets: [solver, pooler, user],
    } = deployment);

    const { authenticator, owner } = deployment;
    await authenticator.connect(owner).addSolver(solver.address);

    weth = await waffle.deployContract(deployer, ERC20, ["WETH", 18]);
    usdc = await waffle.deployContract(deployer, ERC20, ["USDC", 6]);

    uniswapFactory = await waffle.deployContract(deployer, UniswapV2Factory, [
      deployer.address,
    ]);
    await uniswapFactory.createPair(weth.address, usdc.address);
    const uniswapPair = new Contract(
      await uniswapFactory.getPair(weth.address, usdc.address),
      UniswapV2Pair.abi,
      deployer,
    );

    const uniswapWethReserve = ethers.utils.parseEther("1000.0");
    const uniswapUsdtReserve = ethers.utils.parseUnits("600000.0", 6);
    await weth.mint(uniswapPair.address, uniswapWethReserve);
    await usdc.mint(uniswapPair.address, uniswapUsdtReserve);
    await uniswapPair.mint(pooler.address);

    await usdc.mint(user.address, ethers.utils.parseUnits("1000000.0", 6));
  });

  it("sell USDC for WETH", async () => {
    expect(await weth.balanceOf(user.address)).to.equal(ethers.constants.Zero);
    const userUsdcStartingBalance = await usdc.balanceOf(user.address);

    await usdc
      .connect(user)
      .approve(allowanceManager.address, ethers.constants.MaxUint256);

    const uniswapMatch = new UniswapMatch({
      uniswapFactoryAddress: uniswapFactory.address,
      settlementAddress: settlement.address,
      provider: ethers.provider,
    });

    const sellAmount = ethers.utils.parseUnits("600.0", 6);
    const sellToken = usdc.address;
    const buyToken = weth.address;

    const order = await uniswapMatch.createSellOrder({
      sellAmount,
      sellToken,
      buyToken,
    });

    const { chainId } = await ethers.provider.getNetwork();
    const signedDataDomain = domain(chainId, settlement.address);
    const signature = await signOrder(
      signedDataDomain,
      order,
      user,
      SigningScheme.TYPED_DATA,
    );

    await uniswapMatch.submitSolution(
      signature,
      SigningScheme.TYPED_DATA,
      solver,
    );

    expect(order.buyAmount).not.to.equal(ethers.constants.Zero);
    expect(await weth.balanceOf(user.address)).to.equal(order.buyAmount);
    expect(
      userUsdcStartingBalance.sub(await usdc.balanceOf(user.address)),
    ).to.equal(order.sellAmount);
    expect(await usdc.balanceOf(settlement.address)).to.equal(
      ethers.constants.Zero,
    );
    expect(await weth.balanceOf(settlement.address)).to.equal(
      ethers.constants.Zero,
    );
  });
});
