import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { BigNumber, constants, Contract, utils, Wallet } from "ethers";
import hre, { ethers, waffle } from "hardhat";
import { mock, SinonMock, match } from "sinon";

import { APP_DATA } from "../../src/tasks/dump";
import { SupportedNetwork } from "../../src/tasks/ts/deployment";
import { ProviderGasEstimator } from "../../src/tasks/ts/gas";
import { ReferenceToken } from "../../src/tasks/ts/value";
import * as withdrawService from "../../src/tasks/withdrawService";
import { WithdrawAndDumpInput } from "../../src/tasks/withdrawService";
import { OrderKind, domain, Order } from "../../src/ts";
import { Api, Environment, PlaceOrderQuery } from "../../src/ts/api";
import { deployTestContracts } from "../e2e/fixture";
import { synchronizeBlockchainAndCurrentTime } from "../hardhatNetwork";

import { restoreStandardConsole, useDebugConsole } from "./logging";
import {
  mockQuerySellingEthForUsd,
  tradeTokensForNoFees,
} from "./withdraw.test";

use(chaiAsPromised);

describe("Task: withdrawService", () => {
  let deployer: Wallet;
  let solver: SignerWithAddress;
  let trader: Wallet;
  let receiver: Wallet;

  let settlement: Contract;
  let authenticator: Contract;
  let vaultRelayer: Contract;

  let weth: Contract;
  let usdc: Contract;
  let dai: Contract;
  let toToken: Contract;

  let apiMock: SinonMock;
  let api: Api;

  let withdrawAndDumpDefaultParams: () => Promise<
    Omit<WithdrawAndDumpInput, "state">
  >;

  const usdReference: ReferenceToken = {
    address: "0x" + "42".repeat(20),
    symbol: "USD",
    decimals: 42,
  };

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    let solverWallet: Wallet;
    ({
      deployer,
      settlement,
      authenticator,
      vaultRelayer,
      wallets: [solverWallet, receiver, trader],
    } = deployment);
    const foundSolver = (await ethers.getSigners()).find(
      (signer) => signer.address == solverWallet.address,
    );
    expect(foundSolver).not.to.be.undefined;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    solver = foundSolver!;

    const TestERC20 = await hre.artifacts.readArtifact(
      "src/contracts/test/TestERC20.sol:TestERC20",
    );
    dai = await waffle.deployContract(deployer, TestERC20, ["DAI", 18]);
    usdc = await waffle.deployContract(deployer, TestERC20, ["USDC", 6]);
    weth = await waffle.deployContract(deployer, TestERC20, ["WETH", 18]);
    toToken = await waffle.deployContract(deployer, TestERC20, ["toToken", 2]);

    // environment parameter is unused in mock
    const environment = "unset environment" as unknown as Environment;
    api = new Api("mock", environment);
    apiMock = mock(api);

    const { manager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    const domainSeparator = domain(chainId, settlement.address);
    // Trade in order to test automatic retrieval of traded addresses.
    await tradeTokensForNoFees(
      [usdc, weth, dai],
      trader,
      domainSeparator,
      settlement,
      vaultRelayer,
      solver,
    );

    withdrawAndDumpDefaultParams = async () => ({
      solver,
      receiver: receiver.address,
      authenticator,
      settlement,
      settlementDeploymentBlock: 0,
      minValue: "0",
      leftover: "0",
      validity: 3600,
      maxFeePercent: 100,
      slippageBps: 0,
      toToken: toToken.address,
      // ignore network value
      network: undefined as unknown as SupportedNetwork,
      usdReference,
      hre,
      api,
      gasEstimator: new ProviderGasEstimator(ethers.provider),
      dryRun: false,
    });

    // the script checks that the onchain time is not too far from the current
    // time
    if (
      (await ethers.provider.getBlock("latest")).timestamp <
      Math.floor(Date.now() / 1000)
    ) {
      await synchronizeBlockchainAndCurrentTime();
    }

    useDebugConsole();
  });

  afterEach(function () {
    restoreStandardConsole();
    if (this.currentTest?.isPassed()) {
      apiMock.verify();
    }
  });

  it("should withdraw and dump", async () => {
    const initalState: withdrawService.State = {
      lastUpdateBlock: 0,
      tradedTokens: [],
      nextTokenToTrade: 0,
      pendingTokens: [
        // There are pending tokens that simulate a previous run of the script
        // that tried to withdraw these tokens a number of times.
        { address: dai.address, retries: 3 },
        { address: usdc.address, retries: 4 },
      ],
    };
    const defaultParams = await withdrawAndDumpDefaultParams();
    const solverDaiBalance = BigNumber.from(utils.parseUnits("100.0", 18));
    // some dai are left over in the solver address from a previous run
    await dai.mint(solver.address, solverDaiBalance);
    // no usdc balance is there, which means that the usdc entry should not
    // affect the final result (this would occur in practice if for example they
    // were withdrawn in the previous run of the script)

    const minValue = "5.0";
    const leftover = "10.0";
    const ethUsdValue = 1000;
    const daiBalance = utils.parseUnits("20.0", 18);
    await dai.mint(settlement.address, daiBalance);
    const usdcBalance = utils.parseUnits("30.0", 6);
    await usdc.mint(settlement.address, usdcBalance);
    const wethBalance = utils.parseUnits("0.04", 18);
    await weth.mint(settlement.address, wethBalance);
    const daiBalanceMinusLeftover = utils.parseUnits("10.0", 18);
    const usdcBalanceMinusLeftover = utils.parseUnits("20.0", 6);
    const wethBalanceMinusLeftover = utils.parseUnits("0.03", 18);

    expect(await dai.balanceOf(receiver.address)).to.deep.equal(constants.Zero);
    expect(await usdc.balanceOf(receiver.address)).to.deep.equal(
      constants.Zero,
    );
    expect(await weth.balanceOf(receiver.address)).to.deep.equal(
      constants.Zero,
    );

    // query to get eth price for the withdraw script
    mockQuerySellingEthForUsd({
      apiMock,
      amount: utils.parseEther("1"),
      usdReference,
      usdValue: utils.parseUnits(ethUsdValue.toString(), usdReference.decimals),
    });

    apiMock
      .expects("estimateTradeAmount")
      .withArgs({
        sellToken: usdc.address,
        buyToken: usdReference.address,
        kind: OrderKind.SELL,
        amount: usdcBalance,
      })
      .once()
      .returns(
        Promise.resolve(
          usdcBalance.mul(BigNumber.from(10).pow(usdReference.decimals - 6)),
        ),
      );
    apiMock
      .expects("estimateTradeAmount")
      .withArgs({
        sellToken: dai.address,
        buyToken: usdReference.address,
        kind: OrderKind.SELL,
        amount: daiBalance,
      })
      .once()
      .returns(
        Promise.resolve(
          daiBalance.mul(BigNumber.from(10).pow(usdReference.decimals - 18)),
        ),
      );
    apiMock
      .expects("estimateTradeAmount")
      .withArgs({
        sellToken: weth.address,
        buyToken: usdReference.address,
        kind: OrderKind.SELL,
        amount: wethBalance,
      })
      .once()
      .returns(
        Promise.resolve(
          wethBalance
            .mul(ethUsdValue)
            .mul(BigNumber.from(10).pow(usdReference.decimals - 18)),
        ),
      );

    // fee is low except for dai, where it's larger than the maximum allowed
    const maxFeePercent = 25;
    const usdcFee = usdcBalance.div(42);
    const usdcFeeAndQuote = {
      quote: {
        feeAmount: usdcFee,
        buyAmount: BigNumber.from(42),
        sellAmount: BigNumber.from(usdcBalanceMinusLeftover).sub(usdcFee),
      },
    };
    const validity = 3600;

    apiMock
      .expects("getQuote")
      .withArgs({
        sellToken: usdc.address,
        buyToken: toToken.address,
        validTo: match.any,
        appData: APP_DATA,
        partiallyFillable: false,
        from: defaultParams.solver.address,
        kind: OrderKind.SELL,
        sellAmountBeforeFee: usdcBalanceMinusLeftover,
      })
      .twice()
      .returns(Promise.resolve(usdcFeeAndQuote));
    // the solver was storing dai balance from the previous run, which
    // should be included
    const daiBalanceIncludingSolver =
      daiBalanceMinusLeftover.add(solverDaiBalance);
    const daiFee = daiBalanceIncludingSolver.div(2);
    const daiFeeAndQuote = {
      quote: {
        feeAmount: BigNumber.from(daiFee),
        buyAmount: BigNumber.from(1337),
        sellAmount: BigNumber.from(daiBalanceIncludingSolver).sub(daiFee),
      },
    };
    apiMock
      .expects("getQuote")
      .withArgs({
        sellToken: dai.address,
        buyToken: toToken.address,
        validTo: match.any,
        appData: APP_DATA,
        partiallyFillable: false,
        from: defaultParams.solver.address,
        kind: OrderKind.SELL,
        sellAmountBeforeFee: daiBalanceIncludingSolver,
      })
      .once()
      .returns(Promise.resolve(daiFeeAndQuote));
    const wethFee = wethBalance.div(1337);
    const wethFeeAndQuote = {
      quote: {
        feeAmount: wethFee,
        buyAmount: BigNumber.from(1337),
        sellAmount: BigNumber.from(wethBalanceMinusLeftover).sub(wethFee),
      },
    };

    apiMock
      .expects("getQuote")
      .withArgs({
        sellToken: weth.address,
        buyToken: toToken.address,
        validTo: match.any,
        appData: APP_DATA,
        partiallyFillable: false,
        from: defaultParams.solver.address,
        kind: OrderKind.SELL,
        sellAmountBeforeFee: wethBalanceMinusLeftover,
      })
      .twice()
      .returns(Promise.resolve(wethFeeAndQuote));

    function assertGoodOrder(
      order: Order,
      sellToken: string,
      sellAmount: BigNumber,
      buyAmount: BigNumber,
      feeAmount: BigNumber,
    ) {
      expect(order.sellToken).to.deep.equal(sellToken);
      expect(order.buyToken).to.deep.equal(toToken.address);
      expect(order.sellAmount).to.deep.equal(sellAmount);
      expect(order.buyAmount).to.deep.equal(buyAmount);
      expect(order.feeAmount).to.deep.equal(feeAmount);
      expect(order.kind).to.deep.equal(OrderKind.SELL);
      expect(order.receiver).to.deep.equal(receiver.address);
      expect(order.partiallyFillable).to.equal(false);
    }
    api.placeOrder = async function ({ order }: PlaceOrderQuery) {
      switch (order.sellToken) {
        case usdc.address: {
          assertGoodOrder(
            order,
            usdc.address,
            usdcBalanceMinusLeftover.sub(usdcFeeAndQuote.quote.feeAmount),
            usdcFeeAndQuote.quote.buyAmount,
            usdcFeeAndQuote.quote.feeAmount,
          );
          return "0xusdcOrderUid";
        }
        case weth.address: {
          assertGoodOrder(
            order,
            weth.address,
            wethBalanceMinusLeftover.sub(wethFeeAndQuote.quote.feeAmount),
            wethFeeAndQuote.quote.buyAmount,
            wethFeeAndQuote.quote.feeAmount,
          );
          return "0xwethOrderUid";
        }
        default:
          throw new Error(
            `Invalid sell token ${order.sellToken} in mock order`,
          );
      }
    };

    const updatedState = await withdrawService.withdrawAndDump({
      ...defaultParams,
      state: initalState,
      minValue,
      leftover,
      validity,
      maxFeePercent,
    });

    expect(await usdc.allowance(solver.address, vaultRelayer.address)).to.equal(
      constants.MaxUint256,
    );
    expect(await weth.allowance(solver.address, vaultRelayer.address)).to.equal(
      constants.MaxUint256,
    );
    // note: dai is not traded as fees are too high
    expect(await dai.allowance(solver.address, vaultRelayer.address)).to.equal(
      constants.Zero,
    );

    expect(updatedState.lastUpdateBlock).not.to.equal(
      initalState.lastUpdateBlock,
    );
    // there are only three tokens, so the next token to trade is again the one
    // we started with
    expect(updatedState.nextTokenToTrade).to.equal(
      initalState.nextTokenToTrade,
    );
    expect(updatedState.tradedTokens).to.have.length(3);
    expect(
      [usdc, dai, weth].filter(
        (t) => !updatedState.tradedTokens.includes(t.address),
      ),
    ).to.be.empty;
    expect(updatedState.pendingTokens).to.have.length(3);
    // this is the fourth retry for dai, the number of retries should be updated
    expect(updatedState.pendingTokens).to.deep.include({
      address: dai.address,
      retries: 4,
    });
    // the other two start their counter from one, including usdc which was
    // present in the initial state but was already withdrawn
    expect(updatedState.pendingTokens).to.deep.include({
      address: usdc.address,
      retries: 1,
    });
    expect(updatedState.pendingTokens).to.deep.include({
      address: weth.address,
      retries: 1,
    });
  });

  it("should respect pagination", async () => {
    const initalState: withdrawService.State = {
      lastUpdateBlock: 0,
      // note: token order is set in the initial state
      tradedTokens: [dai.address, usdc.address, weth.address],
      nextTokenToTrade: 0,
      pendingTokens: [],
    };
    const defaultParams = await withdrawAndDumpDefaultParams();

    const daiBalance = utils.parseUnits("21.0", 18);
    await dai.mint(settlement.address, daiBalance);
    const usdcBalance = utils.parseUnits("42.0", 6);
    await usdc.mint(settlement.address, usdcBalance);
    const wethBalance = utils.parseUnits("63.0", 18);
    await weth.mint(settlement.address, wethBalance);

    async function setupExpectations(
      token: Contract,
      soldAmount: BigNumber,
    ): Promise<void> {
      // value
      apiMock
        .expects("estimateTradeAmount")
        .withArgs({
          sellToken: token.address,
          buyToken: usdReference.address,
          kind: OrderKind.SELL,
          amount: soldAmount,
        })
        .once()
        .returns(
          soldAmount.mul(
            BigNumber.from(10).pow(
              usdReference.decimals - (await token.decimals()),
            ),
          ),
        ); // stablecoin, so amount in is usd value
      // fee and received amount
      const feeAndQuote = {
        quote: {
          feeAmount: constants.Zero,
          buyAmount: BigNumber.from(1337),
          sellAmount: soldAmount,
        },
      };
      apiMock
        .expects("getQuote")
        .withArgs({
          sellToken: token.address,
          buyToken: toToken.address,
          validTo: match.any,
          appData: APP_DATA,
          partiallyFillable: false,
          from: defaultParams.solver.address,
          kind: OrderKind.SELL,
          sellAmountBeforeFee: soldAmount,
        })
        .twice()
        .returns(Promise.resolve(feeAndQuote));
    }

    // query to get eth price for the withdraw script
    mockQuerySellingEthForUsd({
      apiMock,
      amount: utils.parseEther("1"),
      usdReference,
      usdValue: constants.Zero,
    });

    await setupExpectations(dai, daiBalance);
    await setupExpectations(usdc, usdcBalance);

    let hasSoldUsdc = false;
    let hasSoldDai = false;
    let hasSoldWeth = false;
    api.placeOrder = async function ({ order }: PlaceOrderQuery) {
      switch (order.sellToken) {
        case dai.address: {
          hasSoldDai = true;
          return "0xdaiOrderUid";
        }
        case usdc.address: {
          hasSoldUsdc = true;
          return "0xusdcOrderUid";
        }
        case weth.address: {
          hasSoldWeth = true;
          return "0xwethOrderUid";
        }
        default:
          throw new Error(
            `Invalid sell token ${order.sellToken} in mock order`,
          );
      }
    };

    const pagination = 2;
    const intermediateState = await withdrawService.withdrawAndDump({
      ...defaultParams,
      state: initalState,
      pagination,
    });

    expect(intermediateState.tradedTokens).to.deep.equal(
      initalState.tradedTokens,
    );
    expect(intermediateState.nextTokenToTrade).to.deep.equal(2);
    expect(intermediateState.lastUpdateBlock).not.to.deep.equal(constants.Zero);
    expect(hasSoldDai).to.be.true;
    expect(hasSoldUsdc).to.be.true;
    expect(hasSoldWeth).to.be.false;
    expect(intermediateState.pendingTokens).to.have.length(2);
    expect(intermediateState.pendingTokens).to.deep.include({
      address: dai.address,
      retries: 1,
    });
    expect(intermediateState.pendingTokens).to.deep.include({
      address: usdc.address,
      retries: 1,
    });

    expect(await dai.balanceOf(settlement.address)).to.deep.equal(
      constants.Zero,
    );
    expect(await usdc.balanceOf(settlement.address)).to.deep.equal(
      constants.Zero,
    );
    expect(await weth.balanceOf(settlement.address)).to.deep.equal(wethBalance);

    // simulate order execution (without sending anything to the receiver)
    await dai.connect(solver).burn(daiBalance);
    await usdc.connect(solver).burn(usdcBalance);

    // dai was withdrawn previously, so it needs new balances to be traded again
    await dai.mint(settlement.address, daiBalance.sub(42));

    hasSoldUsdc = false;
    hasSoldDai = false;
    hasSoldWeth = false;

    // query to get eth price for the withdraw script
    mockQuerySellingEthForUsd({
      apiMock,
      amount: utils.parseEther("1"),
      usdReference,
      usdValue: constants.Zero,
    });

    await setupExpectations(weth, wethBalance);
    await setupExpectations(dai, daiBalance.sub(42));

    const finalState = await withdrawService.withdrawAndDump({
      ...(await withdrawAndDumpDefaultParams()),
      state: intermediateState,
      pagination,
    });

    expect(finalState.tradedTokens).to.deep.equal(initalState.tradedTokens);
    expect(finalState.nextTokenToTrade).to.deep.equal(1);
    expect(finalState.lastUpdateBlock).not.to.deep.equal(constants.Zero);
    expect(hasSoldDai).to.be.true;
    expect(hasSoldUsdc).to.be.false;
    expect(hasSoldWeth).to.be.true;
    expect(finalState.pendingTokens).to.have.length(2);
    expect(finalState.pendingTokens).to.deep.include({
      address: weth.address,
      retries: 1,
    });
    expect(finalState.pendingTokens).to.deep.include({
      address: dai.address,
      retries: 1,
    });

    expect(await dai.balanceOf(settlement.address)).to.deep.equal(
      constants.Zero,
    );
    expect(await usdc.balanceOf(settlement.address)).to.deep.equal(
      constants.Zero,
    );
    expect(await weth.balanceOf(settlement.address)).to.deep.equal(
      constants.Zero,
    );
  });

  describe("validates chain id", function () {
    let chainId: number;

    beforeEach(async function () {
      ({ chainId } = await ethers.provider.getNetwork());
    });

    it("throws if the state chain id is incorect", async () => {
      const badChainId = 42;
      expect(chainId).not.to.equal(badChainId);
      const initalState: withdrawService.State = {
        lastUpdateBlock: 0,
        tradedTokens: [],
        nextTokenToTrade: 0,
        pendingTokens: [],
        chainId: badChainId,
      };

      await expect(
        withdrawService.withdrawAndDump({
          ...(await withdrawAndDumpDefaultParams()),
          state: initalState,
        }),
      ).to.eventually.be.rejectedWith(
        `Current state file was created on chain id ${badChainId}, current chain id is ${chainId}.`,
      );
    });

    it("fills in chain id if state has no chain id", async () => {
      const initalState: withdrawService.State = {
        lastUpdateBlock: 0,
        tradedTokens: [],
        nextTokenToTrade: 0,
        pendingTokens: [],
      };

      const finalState = await withdrawService.withdrawAndDump({
        ...(await withdrawAndDumpDefaultParams()),
        state: initalState,
      });

      expect(finalState.chainId).to.equal(chainId);
    });

    it("succeeds with same chain id", async () => {
      const initalState: withdrawService.State = {
        lastUpdateBlock: 0,
        tradedTokens: [],
        nextTokenToTrade: 0,
        pendingTokens: [],
        chainId,
      };

      const finalState = await withdrawService.withdrawAndDump({
        ...(await withdrawAndDumpDefaultParams()),
        state: initalState,
      });

      expect(finalState.chainId).to.equal(chainId);
    });
  });
});
