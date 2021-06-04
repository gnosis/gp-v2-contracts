import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import Debug from "debug";
import { BigNumberish, Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import MockPool from "../../balancer/test/MockPool.json";
import {
  OrderBalance,
  OrderKind,
  SwapEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
  grantRequiredRoles,
} from "../../src/ts";
import { UserBalanceOpKind, BalancerErrors } from "../balancer";

import { deployTestContracts } from "./fixture";

const LOTS = ethers.utils.parseEther("10000.0");
const debug = Debug("e2e:balancerSwap");

describe("E2E: Direct Balancer swap", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let pooler: Wallet;
  let trader: Wallet;

  let vault: Contract;
  let settlement: Contract;
  let vaultRelayer: Contract;
  let domainSeparator: TypedDataDomain;

  let tokens: [Contract, Contract, Contract];
  let pools: Record<string, Contract>;

  let snapshot: unknown;

  before(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      vault,
      settlement,
      vaultRelayer,
      wallets: [solver, pooler, trader],
    } = deployment);

    const { vaultAuthorizer, authenticator, manager } = deployment;
    await grantRequiredRoles(
      vaultAuthorizer.connect(manager),
      vault.address,
      vaultRelayer.address,
    );
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    tokens = [
      await waffle.deployContract(deployer, ERC20, ["TOK1", 18]),
      await waffle.deployContract(deployer, ERC20, ["TOK2", 18]),
      await waffle.deployContract(deployer, ERC20, ["TOK3", 18]),
    ];

    pools = {};
    for (let i = 0; i < tokens.length; i++) {
      const [token0, token1] = [tokens[i], tokens[(i + 1) % tokens.length]];
      const [tokenA, tokenB] =
        token0.address.toLowerCase() < token1.address.toLowerCase()
          ? [token0, token1]
          : [token1, token0];

      const TWO_TOKEN_SPECIALIZATION = 2;
      const pool = await waffle.deployContract(deployer, MockPool, [
        vault.address,
        TWO_TOKEN_SPECIALIZATION,
      ]);
      await pool.registerTokens(
        [tokenA.address, tokenB.address],
        [ethers.constants.AddressZero, ethers.constants.AddressZero],
      );

      for (const token of [tokenA, tokenB]) {
        await token.mint(pooler.address, LOTS);
        await token
          .connect(pooler)
          .approve(vault.address, ethers.constants.MaxUint256);
      }
      await vault
        .connect(pooler)
        .joinPool(await pool.getPoolId(), pooler.address, pooler.address, {
          assets: [tokenA.address, tokenB.address],
          maxAmountsIn: [LOTS, LOTS],
          // NOTE: The mock pool uses this for encoding the pool share amounts
          // that a user (here `pooler`) gets when joining the pool (first value)
          // as well as the pool fees (second value).
          userData: ethers.utils.defaultAbiCoder.encode(
            ["uint256[]", "uint256[]"],
            [
              [LOTS, LOTS],
              [0, 0],
            ],
          ),
          fromInternalBalance: false,
        });

      pools[`${tokenA.address}-${tokenB.address}`] = pool;
      pools[`${tokenB.address}-${tokenA.address}`] = pool;
    }

    snapshot = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    // NOTE: Use EVM snapshots to speed up test execution, as the setup time is
    // quite high (around 1s **per test**). Oddly, snapshots need to be
    // re-created every time they are reverted.
    await ethers.provider.send("evm_revert", [snapshot]);
    snapshot = await ethers.provider.send("evm_snapshot", []);
  });

  const poolFor = (tokenA: Contract, tokenB: Contract) => {
    return pools[`${tokenA.address}-${tokenB.address}`];
  };

  const mintAndApprove = async (
    trader: Wallet,
    token: Contract,
    amount: BigNumberish,
    balance = OrderBalance.ERC20,
  ) => {
    await token.mint(trader.address, amount);
    // NOTE: For now, approve both the Vault and the Vault relayer since we do
    // not distinguish between `ERC20` and `EXTERNAL` balance configurations.
    await token
      .connect(trader)
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);
    await token
      .connect(trader)
      .approve(vault.address, ethers.constants.MaxUint256);
    if (balance == OrderBalance.INTERNAL) {
      await vault.connect(trader).manageUserBalance([
        {
          kind: UserBalanceOpKind.DEPOSIT_INTERNAL,
          asset: token.address,
          amount,
          sender: trader.address,
          recipient: trader.address,
        },
      ]);
    }
    await vault
      .connect(trader)
      .setRelayerApproval(trader.address, vaultRelayer.address, true);
  };

  const balanceOf = async (
    { address }: Wallet | Contract,
    token: Contract,
    balance = OrderBalance.ERC20,
  ) => {
    if (balance == OrderBalance.INTERNAL) {
      const [balance] = await vault.getInternalBalance(address, [
        token.address,
      ]);
      return balance;
    } else {
      return await token.balanceOf(address);
    }
  };

  const balanceVariants = [
    OrderBalance.ERC20,
    OrderBalance.EXTERNAL,
    OrderBalance.INTERNAL,
  ].flatMap((sellTokenBalance) =>
    [OrderBalance.ERC20, OrderBalance.INTERNAL].map((buyTokenBalance) => {
      return {
        name: `${sellTokenBalance} to ${buyTokenBalance}`,
        sellTokenBalance,
        buyTokenBalance,
      };
    }),
  );

  for (const kind of [OrderKind.SELL, OrderKind.BUY]) {
    for (const { name, ...balances } of balanceVariants) {
      it(`performs Balancer swap for ${name} ${kind} order`, async () => {
        await mintAndApprove(
          trader,
          tokens[0],
          ethers.utils.parseEther("100.1"),
          balances.sellTokenBalance,
        );

        const pool = poolFor(tokens[0], tokens[1]);
        // NOTE: Set a fixed multiplier used for computing the exchange rate for
        // the mock pool. In the wild, this would depend on the current state of
        // the pool.
        await pool.setMultiplier(ethers.utils.parseEther("0.9"));

        const encoder = new SwapEncoder(domainSeparator);
        await encoder.signEncodeTrade(
          {
            sellToken: tokens[0].address,
            buyToken: tokens[1].address,
            sellAmount: ethers.utils.parseEther("100.0"),
            buyAmount: ethers.utils.parseEther("72.0"),
            feeAmount: ethers.utils.parseEther("0.1"),
            validTo: 0xffffffff,
            appData: 0,
            partiallyFillable: false,
            kind,
            ...balances,
          },
          trader,
          SigningScheme.EIP712,
        );
        encoder.encodeSwapStep({
          poolId: await pool.getPoolId(),
          assetIn: tokens[0].address,
          assetOut: tokens[1].address,
          amount:
            kind == OrderKind.SELL
              ? ethers.utils.parseEther("100.0")
              : ethers.utils.parseEther("72.0"),
        });

        const tx = await settlement
          .connect(solver)
          .swap(...encoder.encodedSwap());

        const { gasUsed } = await tx.wait();
        debug(`${name} gas: ${gasUsed}`);

        const sellTokenBalance = await balanceOf(
          trader,
          tokens[0],
          balances.sellTokenBalance,
        );
        const buyTokenBalance = await balanceOf(
          trader,
          tokens[1],
          balances.buyTokenBalance,
        );

        // NOTE: User keeps positive surplus!
        if (kind == OrderKind.SELL) {
          expect(sellTokenBalance).to.equal(ethers.constants.Zero);
          expect(buyTokenBalance).to.equal(ethers.utils.parseEther("90.0"));
        } else {
          expect(sellTokenBalance).to.equal(ethers.utils.parseEther("20.0"));
          expect(buyTokenBalance).to.equal(ethers.utils.parseEther("72.0"));
        }
      });
    }

    it(`reverts ${kind} order if fill-or-kill amount is not respected`, async () => {
      await mintAndApprove(trader, tokens[0], ethers.utils.parseEther("100.1"));

      const pool = poolFor(tokens[0], tokens[1]);
      // NOTE: Set a very favourable multiplier for the swap.
      await pool.setMultiplier(ethers.utils.parseEther("2.0"));

      const encoder = new SwapEncoder(domainSeparator);
      await encoder.signEncodeTrade(
        {
          sellToken: tokens[0].address,
          buyToken: tokens[1].address,
          sellAmount: ethers.utils.parseEther("100.0"),
          buyAmount: ethers.utils.parseEther("100.0"),
          feeAmount: ethers.utils.parseEther("0.1"),
          validTo: 0xffffffff,
          appData: 0,
          // NOTE: Partially fillable or not, it doesn't matter as the
          // "fast-path" treats all orders as fill-or-kill orders.
          partiallyFillable: true,
          kind,
        },
        trader,
        SigningScheme.EIP712,
      );
      encoder.encodeSwapStep({
        poolId: await pool.getPoolId(),
        assetIn: tokens[0].address,
        assetOut: tokens[1].address,
        // NOTE: Set "better" amounts, where we pay less and get more. These,
        // however, should still cause a revert as they aren't the exact amounts
        // that were requested in the orders.
        amount:
          kind == OrderKind.SELL
            ? ethers.utils.parseEther("99.0")
            : ethers.utils.parseEther("101.0"),
      });

      await expect(
        settlement.connect(solver).swap(...encoder.encodedSwap()),
      ).to.be.revertedWith(`${kind} amount not respected`);
    });

    it(`reverts ${kind} order if limit price is not respected`, async () => {
      await mintAndApprove(trader, tokens[0], ethers.utils.parseEther("100.1"));

      const pool = poolFor(tokens[0], tokens[1]);
      // NOTE: Set a multiplier that satisfies the order's limit price but not
      // the specified limit amount.
      await pool.setMultiplier(ethers.utils.parseEther("1.1"));

      const encoder = new SwapEncoder(domainSeparator);
      await encoder.signEncodeTrade(
        {
          sellToken: tokens[0].address,
          buyToken: tokens[1].address,
          sellAmount: ethers.utils.parseEther("100.0"),
          buyAmount: ethers.utils.parseEther("100.0"),
          feeAmount: ethers.utils.parseEther("0.1"),
          validTo: 0xffffffff,
          appData: 0,
          partiallyFillable: false,
          kind,
        },
        trader,
        SigningScheme.EIP712,
        {
          limitAmount:
            kind == OrderKind.SELL
              ? ethers.utils.parseEther("120.0")
              : ethers.utils.parseEther("80.0"),
        },
      );
      encoder.encodeSwapStep({
        poolId: await pool.getPoolId(),
        assetIn: tokens[0].address,
        assetOut: tokens[1].address,
        amount: ethers.utils.parseEther("100.0"),
      });

      await expect(
        settlement.connect(solver).swap(...encoder.encodedSwap()),
      ).to.be.revertedWith(BalancerErrors.SWAP_LIMIT);
    });
  }

  it("reverts if order is expired", async () => {
    const { timestamp } = await ethers.provider.getBlock("latest");

    await mintAndApprove(trader, tokens[0], ethers.utils.parseEther("100.1"));

    const encoder = new SwapEncoder(domainSeparator);
    await encoder.signEncodeTrade(
      {
        sellToken: tokens[0].address,
        buyToken: tokens[1].address,
        sellAmount: ethers.utils.parseEther("100.0"),
        buyAmount: ethers.utils.parseEther("72.0"),
        feeAmount: ethers.utils.parseEther("0.1"),
        validTo: timestamp - 1,
        appData: 0,
        kind: OrderKind.SELL,
        partiallyFillable: false,
      },
      trader,
      SigningScheme.EIP712,
    );

    await expect(
      settlement.connect(solver).swap(...encoder.encodedSwap()),
    ).to.be.revertedWith(BalancerErrors.SWAP_DEADLINE);
  });

  it("allows using liquidity from multiple pools", async () => {
    await mintAndApprove(trader, tokens[0], ethers.utils.parseEther("100.1"));

    const encoder = new SwapEncoder(domainSeparator);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        sellToken: tokens[0].address,
        buyToken: tokens[2].address,
        sellAmount: ethers.utils.parseEther("100.0"),
        buyAmount: ethers.utils.parseEther("125.0"),
        feeAmount: ethers.utils.parseEther("0.1"),
        validTo: 0xffffffff,
        appData: 0,
        partiallyFillable: false,
      },
      trader,
      SigningScheme.EIP712,
    );

    // NOTE: Use liquidity by performing a multi-hop swap from `0 -> 1 -> 2`.
    await poolFor(tokens[0], tokens[1]).setMultiplier(
      ethers.utils.parseEther("1.1"),
    );
    encoder.encodeSwapStep({
      poolId: await poolFor(tokens[0], tokens[1]).getPoolId(),
      assetIn: tokens[0].address,
      assetOut: tokens[1].address,
      amount: ethers.utils.parseEther("70.0"),
    });
    await poolFor(tokens[1], tokens[2]).setMultiplier(
      ethers.utils.parseEther("1.2"),
    );
    encoder.encodeSwapStep({
      poolId: await poolFor(tokens[1], tokens[2]).getPoolId(),
      assetIn: tokens[1].address,
      assetOut: tokens[2].address,
      // NOTE: Setting amount to zero indicates a "multi-hop" swap and uses the
      // computed `amountOut` of the previous swap.
      amount: ethers.constants.Zero,
    });
    // NOTE: Also use liquidity from a direct `0 -> 2` pool.
    await poolFor(tokens[0], tokens[2]).setMultiplier(
      ethers.utils.parseEther("1.3"),
    );
    encoder.encodeSwapStep({
      poolId: await poolFor(tokens[0], tokens[2]).getPoolId(),
      assetIn: tokens[0].address,
      assetOut: tokens[2].address,
      amount: ethers.utils.parseEther("30.0"),
    });

    await settlement.connect(solver).swap(...encoder.encodedSwap());

    // NOTE: Sold 70 for 1.1*1.2 and 30 for 1.3, so should receive 131.4.
    expect(await balanceOf(trader, tokens[2])).to.equal(
      ethers.utils.parseEther("131.4"),
    );
  });

  it("allows multi-hop buy orders", async () => {
    await mintAndApprove(trader, tokens[0], ethers.utils.parseEther("13.1"));

    const encoder = new SwapEncoder(domainSeparator);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.BUY,
        buyToken: tokens[2].address,
        sellToken: tokens[0].address,
        buyAmount: ethers.utils.parseEther("100.0"),
        sellAmount: ethers.utils.parseEther("13.0"),
        feeAmount: ethers.utils.parseEther("0.1"),
        validTo: 0xffffffff,
        appData: 0,
        partiallyFillable: false,
      },
      trader,
      SigningScheme.EIP712,
    );

    // NOTE: Use liquidity by performing a multi-hop swap from `2 -> 1 -> 0`.
    await poolFor(tokens[2], tokens[1]).setMultiplier(
      ethers.utils.parseEther("4.0"),
    );
    encoder.encodeSwapStep({
      poolId: await poolFor(tokens[2], tokens[1]).getPoolId(),
      assetOut: tokens[2].address,
      assetIn: tokens[1].address,
      amount: ethers.utils.parseEther("100.0"),
    });
    await poolFor(tokens[1], tokens[0]).setMultiplier(
      ethers.utils.parseEther("2.0"),
    );
    encoder.encodeSwapStep({
      poolId: await poolFor(tokens[1], tokens[0]).getPoolId(),
      assetOut: tokens[1].address,
      assetIn: tokens[0].address,
      // NOTE: Setting amount to zero indicates a "multi-hop" swap and uses the
      // computed `amountIn` of the previous swap.
      amount: ethers.constants.Zero,
    });

    await settlement.connect(solver).swap(...encoder.encodedSwap());

    // NOTE: Bought 100 for 4.0*2.0, so should pay 12.5.
    expect(await balanceOf(trader, tokens[0])).to.equal(
      ethers.utils.parseEther("0.5"),
    );
  });
});
