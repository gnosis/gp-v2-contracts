import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import Debug from "debug";
import { Contract, ContractReceipt, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  Order,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
  packOrderUidParams,
} from "../src/ts";
import { deployTestContracts, TestDeployment } from "../test/e2e/fixture";

const debug = Debug("bench:fixture");
const LOTS = ethers.utils.parseEther("1000000000.0");

export class TokenManager {
  public readonly instances: Contract[] = [];

  public constructor(
    private readonly deployment: TestDeployment,
    private readonly traders: Wallet[],
  ) {}

  public id(id: number): Contract {
    const token = this.instances[id];
    if (token === undefined) {
      throw new Error(`invalid token ID ${id}`);
    }
    return token;
  }

  public async ensureTokenCount(count: number): Promise<void> {
    while (this.instances.length < count) {
      await this.addToken();
    }
  }

  public async addToken(): Promise<Contract> {
    const { allowanceManager, settlement, deployer } = this.deployment;

    const symbol = `T${this.instances.length.toString().padStart(3, "0")}`;
    debug(`creating token ${symbol} and funding traders`);

    const token = await waffle.deployContract(deployer, ERC20, [
      symbol,
      symbol,
    ]);

    // NOTE: Fund the settlement contract is funded with a lot of extra tokens,
    // so the settlements don't have to balance out.
    await token.mint(settlement.address, LOTS);

    for (const trader of this.traders) {
      await token.mint(trader.address, LOTS);
      await token.connect(trader).approve(allowanceManager.address, LOTS);
    }

    this.instances.push(token);
    return token;
  }
}

export interface SettlementOptions {
  tokens: number;
  trades: number;
  interactions: number;
  refunds: number;
}

export class BenchFixture {
  private _nonce = 0;

  private constructor(
    public readonly deployment: TestDeployment,
    public readonly domainSeparator: TypedDataDomain,
    public readonly solver: Wallet,
    public readonly pooler: Wallet,
    public readonly traders: Wallet[],
    public readonly tokens: TokenManager,
    public readonly uniswapFactory: Contract,
    public readonly uniswapTokens: Contract[],
    public readonly uniswapPair: Contract,
  ) {}

  public static async create(): Promise<BenchFixture> {
    debug("deploying GPv2 contracts");
    const deployment = await deployTestContracts();
    const {
      authenticator,
      settlement,
      deployer,
      manager,
      wallets: [solver, pooler, ...traders],
    } = deployment;

    const { chainId } = await ethers.provider.getNetwork();
    const domainSeparator = domain(chainId, settlement.address);

    await authenticator.connect(manager).addSolver(solver.address);

    const tokens = new TokenManager(deployment, traders);

    debug("creating Uniswap pair");
    const uniswapFactory = await waffle.deployContract(
      deployer,
      UniswapV2Factory,
      [deployer.address],
    );
    await tokens.ensureTokenCount(2);
    await uniswapFactory.createPair(tokens.id(0).address, tokens.id(1).address);
    const uniswapPair = new Contract(
      await uniswapFactory.getPair(tokens.id(0).address, tokens.id(1).address),
      UniswapV2Pair.abi,
      deployer,
    );

    debug("funding Uniswap pool");
    const uniswapTokens = [
      await uniswapPair.token0(),
      await uniswapPair.token1(),
    ].map((tokenAddress) => new Contract(tokenAddress, ERC20.abi, deployer));
    await uniswapTokens[0].mint(uniswapPair.address, LOTS);
    await uniswapTokens[1].mint(uniswapPair.address, LOTS);
    await uniswapPair.mint(pooler.address);

    debug("performing Uniswap initial swap to write initial storage values");
    await uniswapTokens[1].mint(
      uniswapPair.address,
      ethers.utils.parseEther("1.0"),
    );
    await uniswapPair.swap(
      ethers.utils.parseEther("0.99"),
      ethers.constants.Zero,
      pooler.address,
      "0x",
    );

    debug("created bench fixture!");
    return new BenchFixture(
      deployment,
      domainSeparator,
      solver,
      pooler,
      traders,
      tokens,
      uniswapFactory,
      uniswapTokens,
      uniswapPair,
    );
  }

  public get nonce(): number {
    return this._nonce++;
  }

  public get settlement(): Contract {
    return this.deployment.settlement;
  }

  public async settle(options: SettlementOptions): Promise<ContractReceipt> {
    debug(`running fixture with ${JSON.stringify(options)}`);

    const {
      deployment: { settlement },
      domainSeparator,
      solver,
      tokens,
      traders,
      uniswapPair,
      uniswapTokens,
    } = this;

    const encoder = new SettlementEncoder(domainSeparator);

    await tokens.ensureTokenCount(options.tokens);
    for (let i = 0; i < options.trades; i++) {
      // NOTE: Alternate the order flags, signing scheme and fee discount in
      // such a way that the benchmark includes all possible combination of
      // `(orderKind, partiallyFillable, signingScheme, feeDiscount)`.

      let orderSpice: Pick<
        Order,
        "kind" | "partiallyFillable" | "sellAmount" | "buyAmount"
      >;
      switch (i % 4) {
        case 0:
          orderSpice = {
            kind: OrderKind.SELL,
            partiallyFillable: false,
            sellAmount: ethers.utils.parseEther("100.0"),
            buyAmount: ethers.utils.parseEther("99.0"),
          };
          break;
        case 1:
          orderSpice = {
            kind: OrderKind.BUY,
            partiallyFillable: false,
            sellAmount: ethers.utils.parseEther("101.0"),
            buyAmount: ethers.utils.parseEther("100.0"),
          };
          break;
        case 2:
          orderSpice = {
            kind: OrderKind.SELL,
            partiallyFillable: true,
            sellAmount: ethers.utils.parseEther("200.0"),
            buyAmount: ethers.utils.parseEther("199.0"),
          };
          break;
        case 3:
          orderSpice = {
            kind: OrderKind.BUY,
            partiallyFillable: true,
            sellAmount: ethers.utils.parseEther("201.0"),
            buyAmount: ethers.utils.parseEther("200.0"),
          };
          break;
        default:
          throw new Error("unreacheable");
      }
      const signingScheme =
        (i + Math.floor(i / 4)) % 2 == 0
          ? SigningScheme.EIP712
          : SigningScheme.ETHSIGN;

      const feeAmount = ethers.utils.parseEther("1.0");
      const feeDiscount = feeAmount.mul(i % 3).div(2); // 0% | 50% | 100%

      const dbg = {
        fill: orderSpice.partiallyFillable
          ? "partially fillable"
          : "fill-or-kill",
        kind: orderSpice.kind == OrderKind.SELL ? "sell" : "buy",
        sign: signingScheme == SigningScheme.EIP712 ? "eip-712" : "eth_sign",
        fee: feeAmount.sub(feeDiscount).mul(100).div(feeAmount).toNumber(),
      };
      debug(
        `encoding ${dbg.fill} ${dbg.kind} order with ${dbg.sign} signature and ${dbg.fee}% fees`,
      );

      await encoder.signEncodeTrade(
        {
          sellToken: tokens.id(i % options.tokens).address,
          buyToken: tokens.id((i + 1) % options.tokens).address,
          feeAmount,
          validTo: 0xffffffff,
          appData: this.nonce,
          ...orderSpice,
        },
        traders[i % traders.length],
        signingScheme,
        orderSpice.partiallyFillable
          ? {
              executedAmount: ethers.utils.parseEther("100.0"),
              // NOTE: Order is exactly half executed, so adjust fee discount as
              // well so that it doesn't execeed the executed fee amount.
              feeDiscount: feeDiscount.div(2),
            }
          : {
              feeDiscount,
            },
      );
    }

    for (let i = 0; i < options.interactions; i++) {
      const [tokenIn, tokenOut] = [i % 2, (i + 1) % 2];
      encoder.encodeInteraction({
        target: uniswapTokens[tokenIn].address,
        callData: uniswapTokens[
          tokenIn
        ].interface.encodeFunctionData("transfer", [
          uniswapPair.address,
          ethers.utils.parseEther("1.0"),
        ]),
      });

      debug(`encoding Uniswap T00${tokenIn} -> T00${tokenOut} token swap`);

      // NOTE: Uniswap pool is large enough that price will pretty much not
      // move over the course of these benchmarks.
      const amountOut = ethers.utils.parseEther("0.9");
      const [amount0Out, amount1Out] =
        tokenIn == 0 ? [0, amountOut] : [amountOut, 0];
      encoder.encodeInteraction({
        target: uniswapPair.address,
        callData: uniswapPair.interface.encodeFunctionData("swap", [
          amount0Out,
          amount1Out,
          settlement.address,
          "0x",
        ]),
      });
    }

    if (options.refunds > 0) {
      debug(`encoding ${options.refunds} order refunds`);
    }
    for (let i = 0; i < options.refunds; i++) {
      const trader = traders[i % traders.length];
      const key = (i + 1).toString(16).padStart(2, "0");
      const orderUid = packOrderUidParams({
        orderDigest: `0x${key}${"42".repeat(31)}`,
        owner: trader.address,
        validTo: 0,
      });

      if (i % 5 !== 0) {
        await settlement.connect(trader).invalidateOrder(orderUid);
        encoder.encodeOrderRefunds({ filledAmounts: [orderUid] });
      } else {
        await settlement.connect(trader).setPreSignature(orderUid, true);
        encoder.encodeOrderRefunds({ preSignatures: [orderUid] });
      }
    }

    const prices = tokens.instances.slice(0, options.tokens).reduce(
      (prices, token) => ({
        ...prices,
        [token.address]: ethers.constants.One,
      }),
      {},
    );

    debug(`executing settlement`);
    const transaction = await settlement
      .connect(solver)
      .settle(...encoder.encodedSettlement(prices));

    return await transaction.wait();
  }
}
