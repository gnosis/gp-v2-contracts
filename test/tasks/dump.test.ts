import { MockContract } from "@ethereum-waffle/mock-contract";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import {
  BigNumber,
  BigNumberish,
  constants,
  Contract,
  utils,
  Wallet,
} from "ethers";
import hre, { ethers, waffle } from "hardhat";
import { mock, SinonMock } from "sinon";

import {
  APP_DATA,
  dump,
  GetDumpInstructionInput,
  getDumpInstructions,
} from "../../src/tasks/dump";
import { SupportedNetwork } from "../../src/tasks/ts/deployment";
import { ProviderGasEstimator } from "../../src/tasks/ts/gas";
import { Erc20Token, isNativeToken } from "../../src/tasks/ts/tokens";
import { BUY_ETH_ADDRESS, OrderKind } from "../../src/ts";
import {
  Api,
  CallError,
  Environment,
  GetQuoteErrorType,
  PlaceOrderQuery,
} from "../../src/ts/api";
import { deployTestContracts } from "../e2e/fixture";
import { synchronizeBlockchainAndCurrentTime } from "../hardhatNetwork";

import { restoreStandardConsole, useDebugConsole } from "./logging";

chai.use(chaiAsPromised);

const IERC20 = hre.artifacts.readArtifact(
  "src/contracts/interfaces/IERC20.sol:IERC20",
);
async function mockErc20(deployer: Wallet) {
  return waffle.deployMockContract(deployer, (await IERC20).abi);
}

interface MockApiCallsInput {
  apiMock: SinonMock;
  toToken: string;
  dumpedToken: string;
  balance: BigNumberish;
  fee: BigNumberish;
  boughtAmount: BigNumberish;
  from: string;
  validTo: number;
}
function mockApiCalls({
  apiMock,
  toToken,
  dumpedToken,
  balance,
  fee,
  boughtAmount,
  from,
  validTo,
}: MockApiCallsInput): void {
  const result = {
    quote: {
      feeAmount: BigNumber.from(fee),
      buyAmount: BigNumber.from(boughtAmount),
    },
  };
  apiMock
    .expects("getQuote")
    .withArgs({
      sellToken: dumpedToken,
      buyToken: toToken,
      validTo,
      appData: APP_DATA,
      partiallyFillable: false,
      from,
      kind: OrderKind.SELL,
      sellAmountBeforeFee: balance,
    })
    .once()
    .returns(Promise.resolve(result));
}

interface MockQuerySellingTokenForEthInput {
  apiMock: SinonMock;
  amount: BigNumber;
  token: string;
  ethValue: BigNumber;
}
export function mockQuerySellingTokenForEth({
  apiMock,
  amount,
  token,
  ethValue,
}: MockQuerySellingTokenForEthInput): void {
  apiMock
    .expects("estimateTradeAmount")
    .withArgs({
      sellToken: token,
      buyToken: wrappedNativeToken,
      kind: OrderKind.SELL,
      amount,
    })
    .once()
    .returns(Promise.resolve(ethValue));
}

// Even if internally handled in the mocking code, some (successful) tests throw
// a warning "Promise rejection was handled asynchronously". This function
// returns a pre-handled rejection to suppress that warning.
// https://github.com/domenic/chai-as-promised/issues/173
async function handledRejection(error?: unknown) {
  const rejection = Promise.reject(error);
  await rejection.catch(() => {
    /* ignored */
  });
  return { rejection };
}

// The getDumpInstructions function depends on the network only to retrieve
// the right weth address for the network, and even then this is only needed
// because of an issue in the services where BUY_ETH_ADDRESS cannot be used
// to get a price quote.
// TODO: remove when BUY_ETH_ADDRESS is supported and implemented in price
// quotes.
const network = undefined as unknown as SupportedNetwork;
const wrappedNativeToken = undefined as unknown as string;

describe("getDumpInstructions", () => {
  let consoleLogOutput: unknown = undefined;
  let consoleLog: typeof console.log;
  const vaultRelayer = "0xa11044a9ce" + "42".repeat(20 - 5);

  let deployer: Wallet;
  let user: Wallet;
  let receiver: Wallet;
  let apiMock: SinonMock;
  let api: Api;

  let defaultDumpInstructions: Omit<
    GetDumpInstructionInput,
    "dumpedTokens" | "toTokenAddress"
  >;

  beforeEach(async () => {
    consoleLog = console.log;
    console.log = (...args: unknown[]) => (consoleLogOutput = args[0]);

    [deployer, user, receiver] = waffle.provider.getWallets();
    // environment parameter is unused in mock
    const environment = "unset environment" as unknown as Environment;
    api = new Api("mock", environment);
    apiMock = mock(api);

    defaultDumpInstructions = {
      user: user.address,
      vaultRelayer: vaultRelayer,
      maxFeePercent: Infinity,
      receiver: {
        address: receiver.address,
        isSameAsUser: true,
      },
      validTo: Math.floor(Date.now() / 1000) + 30 * 60,
      hre,
      network,
      api,
      gasEstimator: new ProviderGasEstimator(ethers.provider),
    };
  });

  afterEach(function () {
    if (this.currentTest?.isPassed()) {
      apiMock.verify();
    }
    console.log = consoleLog;
    consoleLogOutput = undefined;
  });

  it("dumps token for token", async () => {
    const to = await mockErc20(deployer);
    await to.mock.symbol.returns("TOTOKEN");
    await to.mock.decimals.returns(101);
    const dumped = await mockErc20(deployer);
    await dumped.mock.symbol.returns("DUMPEDTOKEN");
    await dumped.mock.decimals.returns(0xd);

    const balance = utils.parseEther("42");
    const fee = utils.parseEther("1");
    const allowance = utils.parseEther("31337");
    const boughtAmount = utils.parseEther("0.1337");

    await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
    await dumped.mock.allowance
      .withArgs(user.address, vaultRelayer)
      .returns(allowance);
    mockApiCalls({
      apiMock,
      toToken: to.address,
      dumpedToken: dumped.address,
      balance,
      fee,
      boughtAmount,
      validTo: defaultDumpInstructions.validTo,
      from: defaultDumpInstructions.user,
    });

    const { toToken, transferToReceiver, instructions } =
      await getDumpInstructions({
        ...defaultDumpInstructions,
        dumpedTokens: [dumped.address],
        toTokenAddress: to.address,
      });

    expect(toToken.symbol).to.deep.equal("TOTOKEN");
    expect(toToken.decimals).to.deep.equal(101);
    expect(isNativeToken(toToken)).to.be.false;
    expect((toToken as Erc20Token).address).to.deep.equal(to.address);

    expect(transferToReceiver).to.be.undefined;

    expect(instructions).to.have.length(1);
    const {
      token: dumpedToken,
      amountWithoutFee,
      needsAllowance,
      receivedAmount,
      balance: returnedBalance,
      fee: returnedFee,
    } = instructions[0];
    expect(dumpedToken.symbol).to.deep.equal("DUMPEDTOKEN");
    expect(dumpedToken.decimals).to.deep.equal(0xd);
    expect(dumpedToken.address).to.deep.equal(dumped.address);
    expect(needsAllowance).to.deep.equal(false);
    expect(receivedAmount).to.deep.equal(boughtAmount);
    expect(amountWithoutFee).to.deep.equal(balance.sub(fee));
    expect(returnedBalance).to.deep.equal(balance);
    expect(returnedFee).to.deep.equal(fee);
  });

  for (const to of [undefined, BUY_ETH_ADDRESS]) {
    it(`dumps token for eth (${
      to === undefined ? "leaving the toToken parameter undefined" : to
    })`, async () => {
      const dumped = await mockErc20(deployer);
      await dumped.mock.symbol.returns("DUMPEDTOKEN");
      await dumped.mock.decimals.returns(0xd);

      const balance = utils.parseEther("42");
      const fee = utils.parseEther("1");
      const allowance = utils.parseEther("31337");
      const boughtAmount = utils.parseEther("0.1337");

      await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
      await dumped.mock.allowance
        .withArgs(user.address, vaultRelayer)
        .returns(allowance);
      mockApiCalls({
        apiMock,
        toToken: wrappedNativeToken,
        dumpedToken: dumped.address,
        balance,
        fee,
        boughtAmount,
        validTo: defaultDumpInstructions.validTo,
        from: defaultDumpInstructions.user,
      });

      const { toToken, transferToReceiver, instructions } =
        await getDumpInstructions({
          ...defaultDumpInstructions,
          dumpedTokens: [dumped.address],
          toTokenAddress: to,
        });

      expect(toToken.symbol).to.deep.equal("ETH");
      expect(toToken.decimals).to.deep.equal(18);
      expect(isNativeToken(toToken)).to.be.true;

      expect(transferToReceiver).to.be.undefined;

      expect(instructions).to.have.length(1);
      const {
        token: dumpedToken,
        amountWithoutFee,
        needsAllowance,
        receivedAmount,
        balance: returnedBalance,
        fee: returnedFee,
      } = instructions[0];
      expect(dumpedToken.symbol).to.deep.equal("DUMPEDTOKEN");
      expect(dumpedToken.decimals).to.deep.equal(0xd);
      expect(dumpedToken.address).to.deep.equal(dumped.address);
      expect(needsAllowance).to.deep.equal(false);
      expect(receivedAmount).to.deep.equal(boughtAmount);
      expect(amountWithoutFee).to.deep.equal(balance.sub(fee));
      expect(returnedBalance).to.deep.equal(balance);
      expect(returnedFee).to.deep.equal(fee);
    });
  }

  it("detects that an allowance is needed", async () => {
    const to = await mockErc20(deployer);
    const dumped = await mockErc20(deployer);

    const balance = utils.parseEther("42");
    const fee = utils.parseEther("1");
    const allowance = balance.sub(1);
    const boughtAmount = utils.parseEther("0.1337");

    await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
    await dumped.mock.allowance
      .withArgs(user.address, vaultRelayer)
      .returns(allowance);
    mockApiCalls({
      apiMock,
      toToken: to.address,
      dumpedToken: dumped.address,
      balance,
      fee,
      boughtAmount,
      validTo: defaultDumpInstructions.validTo,
      from: defaultDumpInstructions.user,
    });

    const { instructions } = await getDumpInstructions({
      ...defaultDumpInstructions,
      dumpedTokens: [dumped.address],
      toTokenAddress: to.address,
    });

    expect(instructions).to.have.length(1);
    const { needsAllowance } = instructions[0];
    expect(needsAllowance).to.deep.equal(true);
  });

  it("ignores toToken if it's dumped", async () => {
    const to = await mockErc20(deployer);
    await to.mock.symbol.returns("TOTOKEN");
    await to.mock.decimals.returns(101);

    const { toToken, transferToReceiver, instructions } =
      await getDumpInstructions({
        ...defaultDumpInstructions,
        receiver: {
          address: receiver.address,
          isSameAsUser: true,
        },
        dumpedTokens: [to.address],
        toTokenAddress: to.address,
      });

    expect(toToken.symbol).to.deep.equal("TOTOKEN");
    expect(toToken.decimals).to.deep.equal(101);
    expect(isNativeToken(toToken)).to.be.false;
    expect((toToken as Erc20Token).address).to.deep.equal(to.address);

    expect(instructions).to.have.length(0);

    expect(transferToReceiver).to.be.undefined;
  });

  it("transfers toToken if it's dumped and there is a custom receiver", async () => {
    const to = await mockErc20(deployer);
    await to.mock.symbol.returns("TOTOKEN");
    await to.mock.decimals.returns(101);

    const balance = utils.parseEther("4.2");
    await to.mock.balanceOf.withArgs(user.address).returns(balance);
    // script estimates gas usage of a transfer
    await to.mock.transfer.withArgs(receiver.address, balance).returns(true);

    mockQuerySellingTokenForEth({
      apiMock,
      amount: balance,
      token: to.address,
      ethValue: BigNumber.from("1"), // default maxFeePercent is infinity, anything nonzero works
    });

    const { toToken, transferToReceiver, instructions } =
      await getDumpInstructions({
        ...defaultDumpInstructions,
        receiver: {
          address: receiver.address,
          isSameAsUser: false,
        },
        dumpedTokens: [to.address],
        toTokenAddress: to.address,
      });

    expect(toToken.symbol).to.deep.equal("TOTOKEN");
    expect(toToken.decimals).to.deep.equal(101);
    expect(isNativeToken(toToken)).to.be.false;
    expect((toToken as Erc20Token).address).to.deep.equal(to.address);

    expect(instructions).to.have.length(0);

    expect(transferToReceiver).not.to.be.undefined;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { amount, token } = transferToReceiver!;
    expect(amount).to.deep.equal(balance);
    expect(token).to.deep.equal(toToken);
  });

  it("throws if trying to dump ETH", async () => {
    await expect(
      getDumpInstructions({
        ...defaultDumpInstructions,
        receiver: {
          address: receiver.address,
          isSameAsUser: false,
        },
        dumpedTokens: [BUY_ETH_ADDRESS],
        toTokenAddress: constants.AddressZero,
      }),
    ).to.eventually.be.rejectedWith(
      `Dumping the native token is not supported. Remove the ETH flag address ${BUY_ETH_ADDRESS} from the list of tokens to dump.`,
    );
  });

  it("throws if api returns generic error when querying for quote", async () => {
    const to = await mockErc20(deployer);
    const dumped = await mockErc20(deployer);

    const balance = utils.parseEther("42");
    const allowance = utils.parseEther("31337");

    await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
    await dumped.mock.allowance
      .withArgs(user.address, vaultRelayer)
      .returns(allowance);
    apiMock
      .expects("getQuote")
      .withArgs({
        sellToken: dumped.address,
        buyToken: to.address,
        validTo: defaultDumpInstructions.validTo,
        appData: APP_DATA,
        partiallyFillable: false,
        from: defaultDumpInstructions.user,
        kind: OrderKind.SELL,
        sellAmountBeforeFee: balance,
      })
      .once()
      .returns((await handledRejection()).rejection);

    await expect(
      getDumpInstructions({
        ...defaultDumpInstructions,
        dumpedTokens: [dumped.address],
        toTokenAddress: to.address,
      }),
    ).to.eventually.be.rejected;
  });

  it("does not trade if fee is larger than balance", async () => {
    const to = await mockErc20(deployer);
    const dumped = await mockErc20(deployer);

    const balance = utils.parseEther("42");
    const allowance = utils.parseEther("31337");

    await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
    await dumped.mock.allowance
      .withArgs(user.address, vaultRelayer)
      .returns(allowance);
    const e: CallError = new Error("Test error");
    e.apiError = {
      errorType: GetQuoteErrorType.SellAmountDoesNotCoverFee,
      description: "unused",
    };
    apiMock
      .expects("getQuote")
      .withArgs({
        sellToken: dumped.address,
        buyToken: to.address,
        validTo: defaultDumpInstructions.validTo,
        appData: APP_DATA,
        partiallyFillable: false,
        from: defaultDumpInstructions.user,
        kind: OrderKind.SELL,
        sellAmountBeforeFee: balance,
      })
      .once()
      .returns((await handledRejection(e)).rejection);

    const { transferToReceiver, instructions } = await getDumpInstructions({
      ...defaultDumpInstructions,
      dumpedTokens: [dumped.address],
      toTokenAddress: to.address,
    });

    expect(transferToReceiver).to.be.undefined;
    expect(instructions).to.have.length(0);

    expect(consoleLogOutput).to.equal(
      `Ignored 42.0 units of ${dumped.address}, the trading fee is larger than the dumped amount.`,
    );
  });

  it("does not trade if fee is larger than percentage limit", async () => {
    const to = await mockErc20(deployer);
    const dumped = await mockErc20(deployer);

    const balance = utils.parseEther("42");
    const maxFeePercent = 50;
    // note: the check doesn't need to be exact and is approximated using
    // floats. This is why here we don't simply add 1
    const fee = utils.parseEther("21.00001");
    const allowance = utils.parseEther("31337");

    await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
    await dumped.mock.allowance
      .withArgs(user.address, vaultRelayer)
      .returns(allowance);
    const result = {
      quote: {
        feeAmount: BigNumber.from(fee),
        buyAmount: BigNumber.from(1337),
      },
    };
    apiMock
      .expects("getQuote")
      .withArgs({
        sellToken: dumped.address,
        buyToken: to.address,
        validTo: defaultDumpInstructions.validTo,
        appData: APP_DATA,
        partiallyFillable: false,
        from: defaultDumpInstructions.user,
        kind: OrderKind.SELL,
        sellAmountBeforeFee: balance,
      })
      .once()
      .returns(Promise.resolve(result));

    const { transferToReceiver, instructions } = await getDumpInstructions({
      ...defaultDumpInstructions,
      maxFeePercent,
      dumpedTokens: [dumped.address],
      toTokenAddress: to.address,
    });

    expect(transferToReceiver).to.be.undefined;
    expect(instructions).to.have.length(0);

    expect(consoleLogOutput).to.match(
      new RegExp(
        `Ignored 42.0 units of ${dumped.address}, the trading fee is too large compared to the balance \\(5[0-9.]+%\\)\\.`,
      ),
    );
  });

  it("does not transfer toToken if the balance is zero", async () => {
    const to = await mockErc20(deployer);
    await to.mock.symbol.returns("TOTOKEN");
    await to.mock.decimals.returns(101);
    await to.mock.balanceOf.withArgs(user.address).returns(constants.Zero);

    const { transferToReceiver } = await getDumpInstructions({
      ...defaultDumpInstructions,
      receiver: {
        address: receiver.address,
        isSameAsUser: false,
      },
      dumpedTokens: [to.address],
      toTokenAddress: to.address,
    });

    expect(transferToReceiver).to.be.undefined;
  });

  it("does not transfer toToken if the transfer fee is too high", async () => {
    const symbol = "TOTOKEN";
    const decimals = 18;
    async function setupMockToToken(balance: BigNumber): Promise<MockContract> {
      const token = await mockErc20(deployer);
      await token.mock.symbol.returns(symbol);
      await token.mock.decimals.returns(decimals);
      await token.mock.balanceOf.withArgs(user.address).returns(balance);
      await token.mock.transfer
        .withArgs(receiver.address, balance)
        .returns(true);
      return token;
    }
    async function estimateTransferGasCost(): Promise<BigNumber> {
      // assumptions: any deployed mock token has approximatively the same
      // transfer cost. The transferred balance doesn't impact much the result.
      // The number is close to 10¹⁸ but not divisible by 2.
      const anyBalance = BigNumber.from(3).pow(32);
      const mock = await setupMockToToken(anyBalance);
      return (
        await mock.estimateGas["transfer"](receiver.address, anyBalance)
      ).mul(await hre.ethers.provider.getGasPrice());
    }
    const maxFeePercent = 5;
    const toTokensForOneEth = 42;
    const transferCost = await estimateTransferGasCost();
    const minimumEthValueToTransfer = transferCost.mul(100).div(maxFeePercent);
    const minimumToTokenBalance =
      minimumEthValueToTransfer.mul(toTokensForOneEth);
    // use half the minimum amount to account for inprecisions in computing
    // the transfer cost
    const balance = minimumToTokenBalance.div(2);
    expect(minimumToTokenBalance).not.to.deep.equal(constants.Zero);
    const to = await setupMockToToken(balance);

    // ten-to-one value with eth
    mockQuerySellingTokenForEth({
      apiMock,
      amount: balance,
      token: to.address,
      ethValue: balance.div(toTokensForOneEth),
    });

    const { transferToReceiver } = await getDumpInstructions({
      ...defaultDumpInstructions,
      receiver: {
        address: receiver.address,
        isSameAsUser: false,
      },
      maxFeePercent,
      dumpedTokens: [to.address],
      toTokenAddress: to.address,
    });

    expect(transferToReceiver).to.be.undefined;
  });

  it("works with many tokens", async () => {
    const to = await mockErc20(deployer);
    await to.mock.symbol.returns("TOTOKEN");
    await to.mock.decimals.returns(101);
    const toTokenBalance = utils.parseEther("4.2");
    await to.mock.balanceOf.withArgs(user.address).returns(toTokenBalance);

    interface TokenConfig {
      balance: BigNumber;
      fee: BigNumber;
      allowance: BigNumber;
      boughtAmount: BigNumber;
      symbol: string;
      decimals: number;
      index: number;
    }
    const isIndexWithTooLargeFee = (index: number) => index % 5 === 1;
    const isIndexWithoutAllowance = (index: number) => index % 7 === 2;
    const pseudorandomTokenConfigs: TokenConfig[] = Array.from(
      utils.arrayify(utils.keccak256("0xbaadc0de")),
    ).map((byte, index) => {
      const balance = constants.WeiPerEther.mul(byte + 1);
      return {
        index,
        balance,
        fee: isIndexWithTooLargeFee(index) ? balance.add(1) : balance.div(100),
        allowance: isIndexWithoutAllowance(index)
          ? balance.sub(1)
          : balance.add(index),
        // note: adding the index guarantees that all amounts are different.
        // This is important since we are checking if the output has the correct
        // order by sorting by this value, and equality might cause the sorting
        // order to change.
        boughtAmount: constants.WeiPerEther.mul(1009 % (byte + 1)).add(index),
        decimals: (byte + index) % 30,
        symbol: `DUMPED${index}`,
      };
    });
    expect(pseudorandomTokenConfigs).to.have.length(32);

    const dumpedTokens: MockContract[] = [];
    for (const {
      balance,
      fee,
      allowance,
      boughtAmount,
      symbol,
      decimals,
      index,
    } of pseudorandomTokenConfigs) {
      const dumped = await mockErc20(deployer);
      await dumped.mock.symbol.returns(symbol);
      await dumped.mock.decimals.returns(decimals);
      await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
      await dumped.mock.allowance
        .withArgs(user.address, vaultRelayer)
        .returns(allowance);
      let apiReturnValue;
      if (isIndexWithTooLargeFee(index)) {
        const e: CallError = new Error("Test error");
        e.apiError = {
          errorType: GetQuoteErrorType.SellAmountDoesNotCoverFee,
          description: "unused",
        };
        apiReturnValue = (await handledRejection(e)).rejection;
      } else {
        const result = {
          quote: {
            feeAmount: fee,
            buyAmount: boughtAmount,
          },
        };
        apiReturnValue = Promise.resolve(result);
      }
      apiMock
        .expects("getQuote")
        .withArgs({
          sellToken: dumped.address,
          buyToken: to.address,
          validTo: defaultDumpInstructions.validTo,
          appData: APP_DATA,
          partiallyFillable: false,
          from: defaultDumpInstructions.user,
          kind: OrderKind.SELL,
          sellAmountBeforeFee: balance,
        })
        .once()
        .returns(apiReturnValue);
      dumpedTokens.push(dumped);
    }

    // mocks needed to estimate transfer cost
    await to.mock.transfer
      .withArgs(receiver.address, toTokenBalance)
      .returns(true);
    mockQuerySellingTokenForEth({
      apiMock,
      amount: toTokenBalance,
      token: to.address,
      ethValue: BigNumber.from("1"), // default maxFeePercent is infinity, anything nonzero works
    });

    const { toToken, transferToReceiver, instructions } =
      await getDumpInstructions({
        ...defaultDumpInstructions,
        receiver: {
          address: receiver.address,
          isSameAsUser: false,
        },
        dumpedTokens: dumpedTokens.map((t) => t.address).concat(to.address),
        toTokenAddress: to.address,
      });

    expect(toToken.symbol).to.deep.equal("TOTOKEN");
    expect(toToken.decimals).to.deep.equal(101);
    expect(isNativeToken(toToken)).to.be.false;
    expect((toToken as Erc20Token).address).to.deep.equal(to.address);

    expect(transferToReceiver).not.to.be.undefined;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { amount, token } = transferToReceiver!;
    expect(amount).to.deep.equal(toTokenBalance);
    expect(token).to.deep.equal(toToken);

    const successfulConfigs = pseudorandomTokenConfigs.filter(
      (_, i) => !isIndexWithTooLargeFee(i),
    );
    expect(instructions)
      .to.have.length(successfulConfigs.length)
      .and.to.be.greaterThan(10);
    successfulConfigs.sort((lhs, rhs) =>
      lhs.boughtAmount.eq(rhs.boughtAmount)
        ? 0
        : lhs.boughtAmount.lt(rhs.boughtAmount)
        ? -1
        : 1,
    );
    instructions.forEach(
      (
        {
          token,
          amountWithoutFee,
          needsAllowance,
          receivedAmount,
          balance: returnedBalance,
          fee: returnedFee,
        },
        sortedIndex,
      ) => {
        const { balance, fee, boughtAmount, symbol, decimals, index } =
          successfulConfigs[sortedIndex];
        expect(token.symbol).to.deep.equal(symbol);
        expect(token.decimals).to.deep.equal(decimals);
        expect(token.address).to.deep.equal(dumpedTokens[index].address);
        expect(needsAllowance).to.deep.equal(isIndexWithoutAllowance(index));
        expect(receivedAmount).to.deep.equal(boughtAmount);
        expect(amountWithoutFee).to.deep.equal(balance.sub(fee));
        expect(returnedBalance).to.deep.equal(balance);
        expect(returnedFee).to.deep.equal(fee);
      },
    );
  });
});

describe("Task: dump", () => {
  let deployer: Wallet;
  let receiver: Wallet;
  let signer: SignerWithAddress;
  let apiMock: SinonMock;
  let api: Api;

  let settlement: Contract;
  let weth: Contract;
  let dai: Contract;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    let signerWallet: Wallet;
    ({
      deployer,
      settlement,
      wallets: [receiver, signerWallet],
    } = deployment);

    const foundSigner = (await hre.ethers.getSigners()).find(
      (signer) => signer.address == signerWallet.address,
    );
    expect(foundSigner).not.to.be.undefined;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    signer = foundSigner!;

    const TestERC20 = await hre.artifacts.readArtifact(
      "src/contracts/test/TestERC20.sol:TestERC20",
    );
    dai = await waffle.deployContract(deployer, TestERC20, ["DAI", 18]);
    weth = await waffle.deployContract(deployer, TestERC20, ["WETH", 18]);

    // environment parameter is unused in mock
    const environment = "unset environment" as unknown as Environment;
    api = new Api("mock", environment);
    apiMock = mock(api);

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

  it("should dump tokens", async () => {
    // Dump dai and weth for weth to a different receiver
    const validity = 4242;
    const validTo = Math.floor(Date.now() / 1000) + validity;

    const wethData = {
      balance: utils.parseEther("42"),
    };
    const daiData = {
      balance: utils.parseEther("31337"),
      fee: utils.parseEther("1337"),
      boughtAmount: utils.parseEther("30"),
    };

    await dai.mint(signer.address, daiData.balance);
    await weth.mint(signer.address, wethData.balance);
    mockApiCalls({
      ...daiData,
      apiMock,
      toToken: weth.address,
      dumpedToken: dai.address,
      validTo,
      from: signer.address,
    });

    api.placeOrder = async function ({ order }: PlaceOrderQuery) {
      expect(order.sellToken).to.deep.equal(dai.address);
      expect(order.buyToken).to.deep.equal(weth.address);
      expect(order.sellAmount).to.deep.equal(daiData.balance.sub(daiData.fee));
      expect(order.buyAmount).to.deep.equal(daiData.boughtAmount);
      expect(order.feeAmount).to.deep.equal(daiData.fee);
      expect(order.kind).to.deep.equal(OrderKind.SELL);
      expect(order.receiver).to.deep.equal(receiver.address);
      expect(order.validTo).to.equal(validTo);
      expect(order.partiallyFillable).to.equal(false);
      return "0xorderUid";
    };

    mockQuerySellingTokenForEth({
      apiMock,
      amount: wethData.balance,
      token: weth.address,
      ethValue: BigNumber.from("1"), // default maxFeePercent is infinity, anything nonzero works
    });

    await dump({
      validTo,
      maxFeePercent: Infinity,
      dumpedTokens: [weth.address, dai.address],
      toToken: weth.address,
      settlement,
      signer,
      receiver: receiver.address,
      network,
      hre,
      api,
      gasEstimator: new ProviderGasEstimator(ethers.provider),
      dryRun: false,
      doNotPrompt: true,
    });

    await expect(weth.balanceOf(receiver.address)).to.eventually.deep.equal(
      wethData.balance,
    );
    await expect(weth.balanceOf(signer.address)).to.eventually.deep.equal(
      constants.AddressZero,
    );
  });

  describe("regressions", () => {
    it("should withdraw toToken if it's the only action to perform", async () => {
      const balance = utils.parseEther("42");
      await weth.mint(signer.address, balance);

      mockQuerySellingTokenForEth({
        apiMock,
        amount: balance,
        token: weth.address,
        ethValue: BigNumber.from("1"), // default maxFeePercent is infinity, anything nonzero works
      });

      await dump({
        validTo: 1337,
        maxFeePercent: Infinity,
        dumpedTokens: [weth.address],
        toToken: weth.address,
        settlement,
        signer,
        receiver: receiver.address,
        network,
        hre,
        api,
        gasEstimator: new ProviderGasEstimator(ethers.provider),
        dryRun: false,
        doNotPrompt: true,
      });

      await expect(weth.balanceOf(receiver.address)).to.eventually.deep.equal(
        balance,
      );
      await expect(weth.balanceOf(signer.address)).to.eventually.deep.equal(
        constants.AddressZero,
      );
    });
  });
});
