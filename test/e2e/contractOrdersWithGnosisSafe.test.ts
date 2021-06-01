import GnosisSafe from "@gnosis.pm/safe-contracts/build/artifacts/contracts/GnosisSafe.sol/GnosisSafe.json";
import CompatibilityFallbackHandler from "@gnosis.pm/safe-contracts/build/artifacts/contracts/handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json";
import GnosisSafeProxyFactory from "@gnosis.pm/safe-contracts/build/artifacts/contracts/proxies/GnosisSafeProxyFactory.sol/GnosisSafeProxyFactory.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import { expect } from "chai";
import { BytesLike, Signer, Contract, Wallet } from "ethers";
import { ethers, waffle } from "hardhat";

import {
  EIP1271_MAGICVALUE,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TypedDataDomain,
  domain,
  hashOrder,
} from "../../src/ts";

import { deployTestContracts } from "./fixture";

interface SafeTransaction {
  to: string;
  data: BytesLike;
}

class GnosisSafeManager {
  constructor(
    readonly deployer: Signer,
    readonly masterCopy: Contract,
    readonly signingFallback: Contract,
    readonly proxyFactory: Contract,
  ) {}

  static async init(deployer: Signer): Promise<GnosisSafeManager> {
    const masterCopy = await waffle.deployContract(deployer, GnosisSafe);
    const proxyFactory = await waffle.deployContract(
      deployer,
      GnosisSafeProxyFactory,
    );
    const signingFallback = await waffle.deployContract(
      deployer,
      CompatibilityFallbackHandler,
    );
    return new GnosisSafeManager(
      deployer,
      masterCopy,
      signingFallback,
      proxyFactory,
    );
  }

  async newSafe(
    owners: string[],
    threshold: number,
    fallback = ethers.constants.AddressZero,
  ): Promise<Contract> {
    const proxyAddress = await this.proxyFactory.callStatic.createProxy(
      this.masterCopy.address,
      "0x",
    );
    await this.proxyFactory.createProxy(this.masterCopy.address, "0x");
    const safe = await ethers.getContractAt(GnosisSafe.abi, proxyAddress);
    await safe.setup(
      owners,
      threshold,
      ethers.constants.AddressZero,
      "0x",
      fallback,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero,
    );
    return safe;
  }
}

async function gnosisSafeSign(
  message: BytesLike,
  signers: Signer[],
): Promise<BytesLike> {
  // https://docs.gnosis.io/safe/docs/contracts_signatures/
  const signerAddresses = await Promise.all(
    signers.map(async (signer) => (await signer.getAddress()).toLowerCase()),
  );
  const sortedSigners = signers
    .map((_, index) => index)
    .sort((lhs, rhs) =>
      signerAddresses[lhs] < signerAddresses[rhs]
        ? -1
        : signerAddresses[lhs] > signerAddresses[rhs]
        ? 1
        : 0,
    )
    .map((index) => signers[index]);

  async function encodeEcdsaSignature(
    message: BytesLike,
    signer: Signer,
  ): Promise<BytesLike> {
    const sig = await signer.signMessage(ethers.utils.arrayify(message));
    const { r, s, v } = ethers.utils.splitSignature(sig);
    return ethers.utils.hexConcat([r, s, [v + 4]]);
  }
  return ethers.utils.hexConcat(
    await Promise.all(
      sortedSigners.map(
        async (signer) => await encodeEcdsaSignature(message, signer),
      ),
    ),
  );
}

async function execSafeTransaction(
  safe: Contract,
  transaction: SafeTransaction,
  signers: Signer[],
): Promise<void> {
  // most parameters are not needed for this test
  const transactionParameters = [
    transaction.to,
    0,
    transaction.data,
    0,
    0,
    0,
    0,
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
  ];
  const nonce = await safe.nonce();
  const message = await safe.getTransactionHash(
    ...transactionParameters,
    nonce,
  );
  const sigs = await gnosisSafeSign(message, signers);
  await safe.execTransaction(...transactionParameters, sigs);
}

async function fallbackSign(
  safeAsFallback: Contract,
  message: BytesLike,
  signers: Signer[],
): Promise<BytesLike> {
  const safeMessage = await safeAsFallback.getMessageHash(
    ethers.utils.defaultAbiCoder.encode(["bytes32"], [message]),
  );
  return gnosisSafeSign(safeMessage, signers);
}

describe("E2E: Order From A Gnosis Safe", () => {
  let deployer: Wallet;
  let solver: Wallet;
  let trader: Wallet;
  let safeOwners: Wallet[];

  let settlement: Contract;
  let vaultRelayer: Contract;
  let safe: Contract;
  let domainSeparator: TypedDataDomain;
  let gnosisSafeManager: GnosisSafeManager;

  beforeEach(async () => {
    const deployment = await deployTestContracts();

    ({
      deployer,
      settlement,
      vaultRelayer,
      wallets: [solver, trader, ...safeOwners],
    } = deployment);

    const { authenticator, manager } = deployment;
    await authenticator.connect(manager).addSolver(solver.address);

    const { chainId } = await ethers.provider.getNetwork();
    domainSeparator = domain(chainId, settlement.address);

    gnosisSafeManager = await GnosisSafeManager.init(deployer);
    safe = await gnosisSafeManager.newSafe(
      safeOwners.map((wallet) => wallet.address),
      2,
      gnosisSafeManager.signingFallback.address,
    );
  });

  it("should settle matching orders", async () => {
    // EOA trader: sell 1 WETH for  900 DAI
    // Safe:       buy  1 WETH for 1100 DAI
    // Settlement price at 1000 DAI for 1 WETH.

    const erc20 = (symbol: string) =>
      waffle.deployContract(deployer, ERC20, [symbol, 18]);

    const dai = await erc20("DAI");
    const weth = await erc20("WETH");

    const UNLIMITED_VALID_TO = 0xffffffff;
    const encoder = new SettlementEncoder(domainSeparator);

    const TRADER_FEE = ethers.utils.parseEther("0.001");
    const TRADER_SOLD_AMOUNT = ethers.utils.parseEther("1.0");
    const TRADER_BOUGHT_AMOUNT = ethers.utils.parseEther("900.0");

    await weth.mint(trader.address, TRADER_SOLD_AMOUNT.add(TRADER_FEE));
    await weth
      .connect(trader)
      .approve(vaultRelayer.address, ethers.constants.MaxUint256);

    encoder.signEncodeTrade(
      {
        kind: OrderKind.SELL,
        partiallyFillable: false,
        sellToken: weth.address,
        buyToken: dai.address,
        sellAmount: TRADER_SOLD_AMOUNT,
        buyAmount: TRADER_BOUGHT_AMOUNT,
        appData: 0,
        validTo: UNLIMITED_VALID_TO,
        feeAmount: TRADER_FEE,
      },
      trader,
      SigningScheme.ETHSIGN,
    );

    const SAFE_FEE = ethers.utils.parseEther("10.0");
    const SAFE_SOLD_AMOUNT = ethers.utils.parseEther("1100.0");
    const SAFE_BOUGHT_AMOUNT = ethers.utils.parseEther("1.0");

    await dai.mint(safe.address, SAFE_SOLD_AMOUNT.add(SAFE_FEE));
    const approveTransaction = {
      to: dai.address,
      data: dai.interface.encodeFunctionData("approve", [
        vaultRelayer.address,
        ethers.constants.MaxUint256,
      ]),
    };
    await execSafeTransaction(safe, approveTransaction, safeOwners);
    expect(
      await dai.allowance(safe.address, vaultRelayer.address),
    ).to.deep.equal(ethers.constants.MaxUint256);

    const order = {
      kind: OrderKind.BUY,
      partiallyFillable: false,
      sellToken: dai.address,
      buyToken: weth.address,
      sellAmount: SAFE_SOLD_AMOUNT,
      buyAmount: SAFE_BOUGHT_AMOUNT,
      appData: 0,
      validTo: UNLIMITED_VALID_TO,
      feeAmount: SAFE_FEE,
    };
    const gpv2Message = hashOrder(domainSeparator, order);
    const safeAsFallback = gnosisSafeManager.signingFallback.attach(
      safe.address,
    );
    // Note: threshold is 2, any two owners should suffice.
    const signature = await fallbackSign(safeAsFallback, gpv2Message, [
      safeOwners[4],
      safeOwners[2],
    ]);
    // Note: the fallback handler provides two versions of `isValidSignature`
    // for compatibility reasons. The following is the signature of the most
    // recent EIP1271-compatible verification function.
    const isValidSignature = "isValidSignature(bytes32,bytes)";
    expect(
      await safeAsFallback.callStatic[isValidSignature](gpv2Message, signature),
    ).to.equal(EIP1271_MAGICVALUE);

    encoder.encodeTrade(order, {
      scheme: SigningScheme.EIP1271,
      data: {
        verifier: safe.address,
        signature,
      },
    });

    await settlement.connect(solver).settle(
      ...encoder.encodedSettlement({
        [dai.address]: ethers.utils.parseEther("1.0"),
        [weth.address]: ethers.utils.parseEther("1000.0"),
      }),
    );

    expect(await weth.balanceOf(trader.address)).to.deep.equal(
      ethers.constants.Zero,
    );
    expect(await dai.balanceOf(trader.address)).to.deep.equal(
      ethers.utils.parseEther("1000.0"),
    );

    expect(await weth.balanceOf(safe.address)).to.deep.equal(
      ethers.utils.parseEther("1.0"),
    );
    expect(await dai.balanceOf(safe.address)).to.deep.equal(
      SAFE_SOLD_AMOUNT.sub(ethers.utils.parseEther("1000.0")),
    );

    expect(await weth.balanceOf(settlement.address)).to.deep.equal(TRADER_FEE);
    expect(await dai.balanceOf(settlement.address)).to.deep.equal(SAFE_FEE);
  });
});
