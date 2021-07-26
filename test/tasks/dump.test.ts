import { MockContract } from "@ethereum-waffle/mock-contract";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import {
  BigNumber,
  BigNumberish,
  constants,
  ethers,
  utils,
  Wallet,
} from "ethers";
import hre, { waffle } from "hardhat";

import {
  GetDumpInstructionInput,
  getDumpInstructions,
} from "../../src/tasks/dump";
import { SupportedNetwork } from "../../src/tasks/ts/deployment";
import { Erc20Token, isNativeToken } from "../../src/tasks/ts/tokens";
import { BUY_ETH_ADDRESS, OrderKind } from "../../src/ts";
import { MockApi } from "../services/mock_api";

chai.use(chaiAsPromised);

const IERC20 = hre.artifacts.readArtifact(
  "src/contracts/interfaces/IERC20.sol:IERC20",
);
async function mockErc20(deployer: Wallet) {
  return waffle.deployMockContract(deployer, (await IERC20).abi);
}

interface MockApiCallsInput {
  api: MockApi;
  toToken: string;
  dumpedToken: string;
  balance: BigNumberish;
  fee: BigNumberish;
  boughtAmount: BigNumberish;
}
function mockApiCalls({
  api,
  toToken,
  dumpedToken,
  balance,
  fee,
  boughtAmount,
}: MockApiCallsInput): void {
  api.mock.getFee
    .withArgs({
      sellToken: dumpedToken,
      buyToken: toToken,
      kind: OrderKind.SELL,
      amount: BigNumber.from(balance),
    })
    .returns(BigNumber.from(fee));
  api.mock.estimateTradeAmount
    .withArgs({
      sellToken: dumpedToken,
      buyToken: toToken,
      kind: OrderKind.SELL,
      amount: BigNumber.from(balance).sub(fee),
    })
    .returns(BigNumber.from(boughtAmount));
}

describe("getDumpInstructions", () => {
  let consoleWarnOutput: unknown = undefined;
  let consoleWarn: typeof console.warn;
  const allowanceManager = "0xa11044a9ce" + "42".repeat(20 - 5);
  // The getDumpInstructions function depends on the network only to retrieve
  // the right weth address for the network, and even then this is only needed
  // because of an issue in the services where BUY_ETH_ADDRESS cannot be used
  // to get a price quote.
  // TODO: remove when BUY_ETH_ADDRESS is supported and implemented in price
  // quotes.
  const network = (undefined as unknown) as SupportedNetwork;
  const wrappedNativeToken = (undefined as unknown) as string;

  let deployer: Wallet;
  let user: Wallet;
  let api = new MockApi();

  let defaultDumpInstructions: Omit<
    GetDumpInstructionInput,
    "dumpedTokens" | "toTokenAddress"
  >;

  beforeEach(async () => {
    consoleWarn = console.warn;
    console.warn = (...args: unknown[]) => (consoleWarnOutput = args[0]);

    [deployer, user] = await waffle.provider.getWallets();
    api = new MockApi();
    defaultDumpInstructions = {
      user: user.address,
      allowanceManager,
      maxFeePercent: 100,
      hasCustomReceiver: false,
      hre,
      network,
      api,
    };
  });

  afterEach(() => {
    api.mock.assertAllExpectationsUsed();
    console.warn = consoleWarn;
    consoleWarnOutput = undefined;
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
      .withArgs(user.address, allowanceManager)
      .returns(allowance);
    mockApiCalls({
      api,
      toToken: to.address,
      dumpedToken: dumped.address,
      balance,
      fee,
      boughtAmount,
    });

    const {
      toToken,
      transferToReceiver,
      instructions,
    } = await getDumpInstructions({
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
    it(`dumps token for eth (${to})`, async () => {
      const dumped = await mockErc20(deployer);
      await dumped.mock.symbol.returns("DUMPEDTOKEN");
      await dumped.mock.decimals.returns(0xd);

      const balance = utils.parseEther("42");
      const fee = utils.parseEther("1");
      const allowance = utils.parseEther("31337");
      const boughtAmount = utils.parseEther("0.1337");

      await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
      await dumped.mock.allowance
        .withArgs(user.address, allowanceManager)
        .returns(allowance);
      mockApiCalls({
        api,
        toToken: wrappedNativeToken,
        dumpedToken: dumped.address,
        balance,
        fee,
        boughtAmount,
      });

      const {
        toToken,
        transferToReceiver,
        instructions,
      } = await getDumpInstructions({
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
      .withArgs(user.address, allowanceManager)
      .returns(allowance);
    mockApiCalls({
      api,
      toToken: to.address,
      dumpedToken: dumped.address,
      balance,
      fee,
      boughtAmount,
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

    const {
      toToken,
      transferToReceiver,
      instructions,
    } = await getDumpInstructions({
      ...defaultDumpInstructions,
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

    const {
      toToken,
      transferToReceiver,
      instructions,
    } = await getDumpInstructions({
      ...defaultDumpInstructions,
      hasCustomReceiver: true,
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
        hasCustomReceiver: true,
        dumpedTokens: [BUY_ETH_ADDRESS],
        toTokenAddress: ethers.constants.AddressZero,
      }),
    ).to.eventually.be.rejectedWith(
      `Dumping the native token is not supported. Remove the ETH flag address ${BUY_ETH_ADDRESS} from the list of tokens to dump.`,
    );
  });

  describe("throws if", () => {
    it("fails to get fees", async () => {
      const to = await mockErc20(deployer);
      const dumped = await mockErc20(deployer);

      const balance = utils.parseEther("42");
      const allowance = utils.parseEther("31337");

      await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
      await dumped.mock.allowance
        .withArgs(user.address, allowanceManager)
        .returns(allowance);
      api.mock.getFee
        .withArgs({
          sellToken: dumped.address,
          buyToken: to.address,
          kind: OrderKind.SELL,
          amount: balance,
        })
        .throwsWith({ errorType: "MockError", description: "mock error" });

      await expect(
        getDumpInstructions({
          ...defaultDumpInstructions,
          dumpedTokens: [dumped.address],
          toTokenAddress: to.address,
        }),
      ).to.eventually.be.rejected;
    });

    it("fails to get trade estimation", async () => {
      const to = await mockErc20(deployer);
      const dumped = await mockErc20(deployer);

      const balance = utils.parseEther("42");
      const fee = utils.parseEther("1");
      const allowance = utils.parseEther("31337");

      await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
      await dumped.mock.allowance
        .withArgs(user.address, allowanceManager)
        .returns(allowance);
      api.mock.getFee
        .withArgs({
          sellToken: dumped.address,
          buyToken: to.address,
          kind: OrderKind.SELL,
          amount: balance,
        })
        .returns(fee);
      api.mock.estimateTradeAmount
        .withArgs({
          sellToken: dumped.address,
          buyToken: to.address,
          kind: OrderKind.SELL,
          amount: BigNumber.from(balance).sub(fee),
        })
        .throws();

      await expect(
        getDumpInstructions({
          ...defaultDumpInstructions,
          dumpedTokens: [dumped.address],
          toTokenAddress: to.address,
        }),
      ).to.eventually.be.rejected;
    });
  });

  it("does not trade if fee is larger than balance", async () => {
    const to = await mockErc20(deployer);
    const dumped = await mockErc20(deployer);

    const balance = utils.parseEther("42");
    const fee = balance.add(1);
    const allowance = utils.parseEther("31337");

    await dumped.mock.balanceOf.withArgs(user.address).returns(balance);
    await dumped.mock.allowance
      .withArgs(user.address, allowanceManager)
      .returns(allowance);
    api.mock.getFee
      .withArgs({
        sellToken: dumped.address,
        buyToken: to.address,
        kind: OrderKind.SELL,
        amount: balance,
      })
      .returns(BigNumber.from(fee));

    const { transferToReceiver, instructions } = await getDumpInstructions({
      ...defaultDumpInstructions,
      dumpedTokens: [dumped.address],
      toTokenAddress: to.address,
    });

    expect(transferToReceiver).to.be.undefined;
    expect(instructions).to.have.length(0);

    expect(consoleWarnOutput).to.equal(
      `Dump request skipped for token ${dumped.address}. The trading fee is larger than the dumped amount.`,
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
      .withArgs(user.address, allowanceManager)
      .returns(allowance);
    api.mock.getFee
      .withArgs({
        sellToken: dumped.address,
        buyToken: to.address,
        kind: OrderKind.SELL,
        amount: balance,
      })
      .returns(BigNumber.from(fee));

    const { transferToReceiver, instructions } = await getDumpInstructions({
      ...defaultDumpInstructions,
      maxFeePercent,
      dumpedTokens: [dumped.address],
      toTokenAddress: to.address,
    });

    expect(transferToReceiver).to.be.undefined;
    expect(instructions).to.have.length(0);

    expect(consoleWarnOutput).to.match(
      new RegExp(
        `Dump request skipped for token ${dumped.address}\\. The trading fee is too large compared to the balance \\([0-9.]*%\\)\\.`,
      ),
    );
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

    api.mock.ignoreExpectationOrder();
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
        .withArgs(user.address, allowanceManager)
        .returns(allowance);
      api.mock.getFee
        .withArgs({
          sellToken: dumped.address,
          buyToken: to.address,
          kind: OrderKind.SELL,
          amount: balance,
        })
        .returns(BigNumber.from(fee));
      if (!isIndexWithTooLargeFee(index)) {
        api.mock.estimateTradeAmount
          .withArgs({
            sellToken: dumped.address,
            buyToken: to.address,
            kind: OrderKind.SELL,
            amount: BigNumber.from(balance).sub(fee),
          })
          .returns(BigNumber.from(boughtAmount));
      }
      dumpedTokens.push(dumped);
    }

    const {
      toToken,
      transferToReceiver,
      instructions,
    } = await getDumpInstructions({
      ...defaultDumpInstructions,
      hasCustomReceiver: true,
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
        const {
          balance,
          fee,
          boughtAmount,
          symbol,
          decimals,
          index,
        } = successfulConfigs[sortedIndex];
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
