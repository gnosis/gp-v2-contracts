import type { Provider } from "@ethersproject/abstract-provider";
import type { BuidlerNetworkAccount } from "@nomiclabs/buidler/types";
import { Wallet, utils } from "ethers";

const TESTING_MNEMONIC =
  "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";
const TESTING_ACCOUNTS_INITIAL_INDEX = 0;
const TESTING_ACCOUNTS_COUNT = 10;
const TESTING_ACCOUNTS_PATH = "m/44'/60'/0'/0";

export function testingAccounts(provider?: Provider): Wallet[] {
  const range = Array(TESTING_ACCOUNTS_COUNT - TESTING_ACCOUNTS_INITIAL_INDEX)
    .fill(undefined)
    .map((_, index) => TESTING_ACCOUNTS_COUNT + index);
  const wallets = range.map((index) =>
    Wallet.fromMnemonic(TESTING_MNEMONIC, TESTING_ACCOUNTS_PATH + "/" + index),
  );
  return provider ? wallets.map((wallet) => wallet.connect(provider)) : wallets;
}

export function buidlerTestingAccounts(): BuidlerNetworkAccount[] {
  return testingAccounts().map((wallet) => ({
    privateKey: wallet.privateKey,
    balance: utils.parseEther("1000").toString(),
  }));
}
