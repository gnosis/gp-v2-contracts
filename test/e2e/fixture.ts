import { Contract, Wallet } from "ethers";
import { deployments, network, ethers } from "hardhat";

export interface TestDeployment {
  deployer: Wallet;
  owner: Wallet;
  manager: Wallet;
  wallets: Wallet[];
  authenticator: Contract;
  vault: Contract;
  settlement: Contract;
  allowanceManager: Contract;
  vaultRelayer: Contract;
  gasToken: Contract;
}

export const deployTestContracts: () => Promise<TestDeployment> = deployments.createFixture(
  async ({
    deployments,
    ethers,
    getNamedAccounts,
    getUnnamedAccounts,
    waffle,
  }) => {
    const {
      GPv2AllowListAuthentication,
      GPv2Settlement,
    } = await deployments.fixture();

    const allWallets = waffle.provider.getWallets();
    const {
      deployer,
      owner,
      manager,
      vault: vaultAddress,
    } = await getNamedAccounts();
    const unnamedAccounts = await getUnnamedAccounts();

    const authenticator = await ethers.getContractAt(
      "GPv2AllowListAuthentication",
      GPv2AllowListAuthentication.address,
    );
    const vault = await ethers.getContractAt("IVault", vaultAddress);
    const settlement = await ethers.getContractAt(
      "GPv2Settlement",
      GPv2Settlement.address,
    );
    const allowanceManager = await ethers.getContractAt(
      "GPv2AllowanceManager",
      await settlement.allowanceManager(),
    );
    const vaultRelayer = await ethers.getContractAt(
      "GPv2VaultRelayer",
      await settlement.vaultRelayer(),
    );

    return {
      deployer: findAccountWallet(allWallets, deployer),
      owner: findAccountWallet(allWallets, owner),
      manager: findAccountWallet(allWallets, manager),
      wallets: unnamedAccounts.map((account) =>
        findAccountWallet(allWallets, account),
      ),
      authenticator,
      vault,
      settlement,
      allowanceManager,
      vaultRelayer,
      gasToken: await deployGasToken(allWallets[0]),
    };
  },
);

const CHI_TOKEN_DEPLOYER = "0x7E1E3334130355799F833ffec2D731BCa3E68aF6";

async function deployGasToken(deployer: Wallet) {
  // Deploy ChiToken with original creator account so that deployed address is same as on mainnet
  // Otherwise, the selfdestruct logic will not work as it hard-codes the ChiToken address.
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [CHI_TOKEN_DEPLOYER],
  });
  const chi_token_deployer = ethers.provider.getSigner(CHI_TOKEN_DEPLOYER);
  await deployer.sendTransaction({
    to: CHI_TOKEN_DEPLOYER,
    value: ethers.utils.parseEther("1.0"),
  });
  const ChiToken = await ethers.getContractFactory(
    "ChiToken",
    chi_token_deployer,
  );
  const chiToken = await ChiToken.deploy();
  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [CHI_TOKEN_DEPLOYER],
  });
  return chiToken;
}

function findAccountWallet(wallets: Wallet[], account: string): Wallet {
  const wallet = wallets.find((wallet) => wallet.address === account);
  if (wallet === undefined) {
    throw new Error(`no wallet found for account ${account}`);
  }

  return wallet;
}
