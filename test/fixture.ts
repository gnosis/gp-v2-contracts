import { Contract, Wallet } from "ethers";
import { deployments } from "hardhat";

export interface TestDeployment {
  deployer: Wallet;
  owner: Wallet;
  wallets: Wallet[];
  authenticator: Contract;
  settlement: Contract;
  allowanceManager: Contract;
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
    const { deployer, owner } = await getNamedAccounts();
    const unnamedAccounts = await getUnnamedAccounts();

    const authenticator = await ethers.getContractAt(
      "GPv2AllowListAuthentication",
      GPv2AllowListAuthentication.address,
    );
    const settlement = await ethers.getContractAt(
      "GPv2Settlement",
      GPv2Settlement.address,
    );
    const allowanceManager = await ethers.getContractAt(
      "GPv2AllowanceManager",
      await settlement.allowanceManager(),
    );

    return {
      deployer: findAccountWallet(allWallets, deployer),
      owner: findAccountWallet(allWallets, owner),
      wallets: unnamedAccounts.map((account) =>
        findAccountWallet(allWallets, account),
      ),
      authenticator,
      settlement,
      allowanceManager,
    };
  },
);

function findAccountWallet(wallets: Wallet[], account: string): Wallet {
  const wallet = wallets.find((wallet) => wallet.address === account);
  if (wallet === undefined) {
    throw new Error(`no wallet found for account ${account}`);
  }

  return wallet;
}
