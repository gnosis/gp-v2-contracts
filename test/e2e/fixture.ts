import WETHArtifact from "canonical-weth/build/contracts/WETH9.json";
import { Contract, Wallet } from "ethers";
import { deployments, network, ethers } from "hardhat";

import AuthorizerArtifact from "../../balancer/Authorizer.json";
import VaultArtifact from "../../balancer/Vault.json";

export interface TestDeployment {
  deployer: Wallet;
  owner: Wallet;
  manager: Wallet;
  wallets: Wallet[];
  weth: Contract;
  vaultAuthorizer: Contract;
  vault: Contract;
  authenticator: Contract;
  settlement: Contract;
  vaultRelayer: Contract;
  tradeSimulator: Contract;
  gasToken: Contract;
}

export const deployTestContracts: () => Promise<TestDeployment> =
  deployments.createFixture(
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
        GPv2TradeSimulator,
        Vault,
        VaultAuthorizer,
        WETH,
      } = await deployments.fixture();

      const allWallets = waffle.provider.getWallets();
      const { deployer, owner, manager } = await getNamedAccounts();
      const unnamedAccounts = await getUnnamedAccounts();
      const deployerWallet = findAccountWallet(allWallets, deployer);

      const weth = new Contract(WETH.address, WETHArtifact.abi, deployerWallet);
      const vaultAuthorizer = new Contract(
        VaultAuthorizer.address,
        AuthorizerArtifact.abi,
        deployerWallet,
      );
      const vault = new Contract(
        Vault.address,
        VaultArtifact.abi,
        deployerWallet,
      );
      const authenticator = await ethers.getContractAt(
        "GPv2AllowListAuthentication",
        GPv2AllowListAuthentication.address,
      );
      const settlement = await ethers.getContractAt(
        "GPv2Settlement",
        GPv2Settlement.address,
      );
      const vaultRelayer = await ethers.getContractAt(
        "GPv2VaultRelayer",
        await settlement.vaultRelayer(),
      );
      const tradeSimulator = await ethers.getContractAt(
        "GPv2TradeSimulator",
        GPv2TradeSimulator.address,
      );

      return {
        deployer: deployerWallet,
        owner: findAccountWallet(allWallets, owner),
        manager: findAccountWallet(allWallets, manager),
        wallets: unnamedAccounts.map((account) =>
          findAccountWallet(allWallets, account),
        ),
        weth,
        vaultAuthorizer,
        vault,
        authenticator,
        settlement,
        vaultRelayer,
        tradeSimulator,
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
