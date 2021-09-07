import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { constants, Contract, utils, Wallet } from "ethers";
import hre, { ethers, waffle } from "hardhat";
import sinon, { SinonMock } from "sinon";

import { Api, Environment } from "../../src/services/api";
import { SupportedNetwork } from "../../src/tasks/ts/deployment";
import { ReferenceToken } from "../../src/tasks/ts/value";
import { withdraw } from "../../src/tasks/withdraw";
import {
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
} from "../../src/ts";
import { deployTestContracts } from "../e2e/fixture";

import { restoreStandardConsole, useDebugConsole } from "./logging";

// Executes trades between the input tokens in order to emit trade events.
export async function tradeTokensForNoFees(
  tokens: Contract[],
  trader: Wallet,
  domainSeparator: TypedDataDomain,
  settlement: Contract,
  allowanceManager: Contract,
  solver: SignerWithAddress,
): Promise<void> {
  const encoder = new SettlementEncoder(domainSeparator);

  const consecutiveTokenPairs = tokens.map((token, index) => [
    token,
    tokens[(index + 1) % tokens.length],
  ]);
  for (const [sell, buy] of consecutiveTokenPairs) {
    await sell.mint(trader.address, 1);
    await sell.connect(trader).approve(allowanceManager.address, 1);
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
    apiMock = sinon.mock(api);

    const { manager, allowanceManager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    const domainSeparator = domain(chainId, settlement.address);
    // Trade in order to test automatic retrieval of traded addresses.
    await tradeTokensForNoFees(
      [usdc, weth, dai],
      trader,
      domainSeparator,
      settlement,
      allowanceManager,
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

    const usdReference: ReferenceToken = {
      address: "0x" + "42".repeat(20),
      symbol: "USD",
      decimals: 42,
    };

    apiMock
      .expects("estimateTradeAmount")
      .withArgs({
        sellToken: usdc.address,
        buyToken: usdReference.address,
        kind: OrderKind.SELL,
        amount: utils.parseUnits("1", 6),
      })
      .once()
      .returns(Promise.resolve(utils.parseUnits("1", usdReference.decimals)));
    apiMock
      .expects("estimateTradeAmount")
      .withArgs({
        sellToken: dai.address,
        buyToken: usdReference.address,
        kind: OrderKind.SELL,
        amount: utils.parseUnits("1", 18),
      })
      .once()
      .returns(Promise.resolve(utils.parseUnits("1", usdReference.decimals)));
    apiMock
      .expects("estimateTradeAmount")
      .withArgs({
        sellToken: weth.address,
        buyToken: usdReference.address,
        kind: OrderKind.SELL,
        amount: utils.parseUnits("1", 18),
      })
      .once()
      .returns(
        Promise.resolve(
          utils.parseUnits("1", usdReference.decimals).mul(ethUsdValue),
        ),
      );

    const withdrawnTokens = await withdraw({
      solver,
      receiver: receiver.address,
      authenticator,
      settlement,
      settlementDeploymentBlock: 0,
      latestBlock: await ethers.provider.getBlockNumber(),
      minValue,
      leftover,
      tokens: undefined,
      usdReference,
      // ignored network value
      network: undefined as unknown as SupportedNetwork,
      hre,
      api,
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
});
