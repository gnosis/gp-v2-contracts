import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, constants, Contract, utils, Wallet } from "ethers";
import hre, { ethers, waffle } from "hardhat";
import { mock, SinonMock } from "sinon";

import { SupportedNetwork } from "../../src/tasks/ts/deployment";
import { ProviderGasEstimator } from "../../src/tasks/ts/gas";
import { ReferenceToken } from "../../src/tasks/ts/value";
import { withdraw } from "../../src/tasks/withdraw";
import {
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";
import { Api, Environment } from "../../src/ts/api";
import { deployTestContracts } from "../e2e/fixture";

import { restoreStandardConsole, useDebugConsole } from "./logging";

interface MockQuerySellingEthForUsdInput {
  apiMock: SinonMock;
  amount: BigNumber;
  usdReference: ReferenceToken;
  usdValue: BigNumber;
}
export function mockQuerySellingEthForUsd({
  apiMock,
  amount,
  usdReference,
  usdValue,
}: MockQuerySellingEthForUsdInput): void {
  apiMock
    .expects("estimateTradeAmount")
    .withArgs({
      sellToken: undefined, // note: weth is undefined for the hardhat network
      buyToken: usdReference.address,
      kind: OrderKind.SELL,
      amount,
    })
    .once()
    .returns(Promise.resolve(usdValue));
}

// Executes trades between the input tokens in order to emit trade events.
export async function tradeTokensForNoFees(
  tokens: Contract[],
  trader: Wallet,
  domainSeparator: TypedDataDomain,
  settlement: Contract,
  vaultRelayer: Contract,
  solver: SignerWithAddress,
): Promise<void> {
  const encoder = new SettlementEncoder(domainSeparator);

  const consecutiveTokenPairs = tokens.map((token, index) => [
    token,
    tokens[(index + 1) % tokens.length],
  ]);
  for (const [sell, buy] of consecutiveTokenPairs) {
    await sell.mint(trader.address, 1);
    await sell.connect(trader).approve(vaultRelayer.address, 1);
    await encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: sell.address,
        buyToken: buy.address,
        sellAmount: 1,
        buyAmount: 1,
        feeAmount: 0,
        validTo: 0xffffffff,
        appData: 0,
      },
      trader,
      SigningScheme.EIP712,
    );
  }
  const prices: Record<string, number> = {};
  tokens.forEach((token) => {
    prices[token.address] = 1;
  });
  await settlement.connect(solver).settle(...encoder.encodedSettlement(prices));
}

describe("Task: withdraw", () => {
  let deployer: Wallet;
  let solver: SignerWithAddress;
  let trader: Wallet;
  let receiver: Wallet;

  let settlement: Contract;
  let authenticator: Contract;

  let weth: Contract;
  let usdc: Contract;
  let dai: Contract;

  let apiMock: SinonMock;
  let api: Api;

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

    // environment parameter is unused in mock
    const environment = "unset environment" as unknown as Environment;
    api = new Api("mock", environment);
    apiMock = mock(api);

    const { manager, vaultRelayer } = deployment;
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

    useDebugConsole();
  });

  afterEach(function () {
    restoreStandardConsole();
    if (this.currentTest?.isPassed()) {
      apiMock.verify();
    }
  });

  it("should withdraw tokens from the settlement contract", async () => {
    const minValue = "8.0";
    const leftover = "9.0";
    const ethUsdValue = 1000;
    // dai is the only token that should not be withdrawn as it's below the
    // parameter threshold of 8+9=17
    const daiBalance = utils.parseUnits("10.0", 18);
    await dai.mint(settlement.address, daiBalance);
    const usdcBalance = utils.parseUnits("20.0", 6);
    await usdc.mint(settlement.address, usdcBalance);
    const wethBalance = utils.parseUnits("0.02", 18);
    await weth.mint(settlement.address, wethBalance);

    expect(await dai.balanceOf(receiver.address)).to.deep.equal(constants.Zero);
    expect(await usdc.balanceOf(receiver.address)).to.deep.equal(
      constants.Zero,
    );
    expect(await weth.balanceOf(receiver.address)).to.deep.equal(
      constants.Zero,
    );

    // query to get eth price
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
          Promise.resolve(
            wethBalance
              .mul(ethUsdValue)
              .mul(BigNumber.from(10).pow(usdReference.decimals - 18)),
          ),
        ),
      );

    const withdrawnTokens = await withdraw({
      solver,
      receiver: receiver.address,
      authenticator,
      settlement,
      settlementDeploymentBlock: 0,
      minValue,
      leftover,
      maxFeePercent: Infinity,
      tokens: undefined,
      usdReference,
      // ignored network value
      network: undefined as unknown as SupportedNetwork,
      hre,
      api,
      gasEstimator: new ProviderGasEstimator(ethers.provider),
      dryRun: false,
      doNotPrompt: true,
    });

    expect(withdrawnTokens).to.have.length(2);
    expect(withdrawnTokens).to.include(usdc.address);
    expect(withdrawnTokens).to.include(weth.address);
    expect(await dai.balanceOf(receiver.address)).to.deep.equal(constants.Zero);
    expect(await usdc.balanceOf(receiver.address)).to.deep.equal(
      usdcBalance.sub(utils.parseUnits(leftover, 6)),
    );
    expect(await weth.balanceOf(receiver.address)).to.deep.equal(
      wethBalance.sub(utils.parseUnits(leftover, 18).div(ethUsdValue)),
    );
  });

  it("should withdraw only tokens for which the gas fee is not too high", async () => {
    const minValue = "0";
    const leftover = "0";
    // This value was chosen so that the dai withdraw would not succeed because
    // the gas fee is too expensive, but the weth one would.
    // If this test fails, it could be because the Ethereum implementation of
    // the test node changed the gas cost of some opcodes. You can update this
    // value by running the test with this value set to zero and printing the
    // output of the test with the DEBUG flag. In the output, you can find
    // something similar to:
    // ```
    // test:console:log Ignored 10.0 units of DAI (0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6) with value 10.00 USD, the gas cost of including this transaction is too high (0.42% of the withdrawn amount) +2s
    // test:console:log Ignored 0.02 units of WETH (0x610178dA211FEF7D417bC0e6FeD39F05609AD788) with value 20.00 USD, the gas cost of including this transaction is too high (0.21% of the withdrawn amount) +0ms
    // ```
    // Then, change the max fee percentage to a number between the two percent
    // values from the logs.
    const maxFeePercent = 0.3;
    const ethUsdValue = 1000;

    const daiBalance = utils.parseUnits("10.0", 18);
    await dai.mint(settlement.address, daiBalance);
    // The weth balance has double the value of the dai balance. The two values
    // can't be too close, as otherwise the test would be too sensitive to
    // small changes in gas when running the test, but also not too far so that
    // errors in the math would cause an error in the test.
    const wethBalance = utils.parseUnits("0.02", 18);
    await weth.mint(settlement.address, wethBalance);

    expect(await dai.balanceOf(receiver.address)).to.deep.equal(constants.Zero);
    expect(await weth.balanceOf(receiver.address)).to.deep.equal(
      constants.Zero,
    );

    // query to get eth price
    mockQuerySellingEthForUsd({
      apiMock,
      amount: utils.parseEther("1"),
      usdReference,
      usdValue: utils.parseUnits(ethUsdValue.toString(), usdReference.decimals),
    });

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
          Promise.resolve(
            wethBalance
              .mul(ethUsdValue)
              .mul(BigNumber.from(10).pow(usdReference.decimals - 18)),
          ),
        ),
      );

    const withdrawnTokens = await withdraw({
      solver,
      receiver: receiver.address,
      authenticator,
      settlement,
      settlementDeploymentBlock: 0,
      minValue,
      leftover,
      maxFeePercent,
      tokens: undefined,
      usdReference,
      // ignored network value
      network: undefined as unknown as SupportedNetwork,
      hre,
      api,
      gasEstimator: new ProviderGasEstimator(ethers.provider),
      dryRun: false,
      doNotPrompt: true,
    });

    expect(withdrawnTokens).to.have.length(1);
    expect(withdrawnTokens).to.include(weth.address);
    expect(await dai.balanceOf(receiver.address)).to.deep.equal(constants.Zero);
    expect(await weth.balanceOf(receiver.address)).to.deep.equal(wethBalance);
  });
});
