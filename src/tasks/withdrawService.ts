import "@nomiclabs/hardhat-ethers";

import { promises as fs } from "fs";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { assert } from "chai";
import { utils, Contract } from "ethers";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Api, Environment } from "../services/api";
import { BUY_ETH_ADDRESS } from "../ts";

import { dump, MAX_ORDER_VALIDITY_SECONDS } from "./dump";
import {
  getDeployedContract,
  isSupportedNetwork,
  SupportedNetwork,
} from "./ts/deployment";
import { sleep } from "./ts/sleep";
import { balanceOf, erc20Token } from "./ts/tokens";
import { ReferenceToken, REFERENCE_TOKEN } from "./ts/value";
import { withdraw } from "./withdraw";
import { getAllTradedTokens } from "./withdraw/traded_tokens";

const MAX_ORDER_RETRIES_BEFORE_SKIPPING = 10;
const MAX_CHECKED_TOKENS_PER_RUN = 200;

export interface State {
  /**
   * Latest block number when the balances were withdrawn in the previous run.
   */
  lastUpdateBlock: number;
  /**
   * All tokens ever traded on GPv2. Stored in the state to avoid stressing the
   * node by recovering the list every time.
   */
  tradedTokens: string[];
  /**
   * Index (in tradedTokens) following that of the last withdrawn token in the
   * previous run of this script.
   */
  nextTokenToTrade: number;
  /**
   * Tokens that have a pending order from a previous execution of the withdraw
   * service.
   */
  pendingTokens: PendingToken[];
}

interface PendingToken {
  /**
   * The address of the token.
   */
  address: string;
  /**
   * How many consecutive times the script sold this token with no success.
   * Note that the script will not wait to check if the orders were successful,
   * which means that every order in a run will add a pending token with one
   * retry.
   */
  retries: number;
}

function isValidState(state: unknown): state is State {
  if (state === null || typeof state !== "object") {
    console.error("State json is not an object");
    return false;
  }
  const stateObject = state as State;
  if (typeof stateObject["lastUpdateBlock"] !== "number") {
    console.error("Invalid lastUpdateBlock");
    return false;
  }
  if (typeof stateObject["nextTokenToTrade"] !== "number") {
    console.error("Invalid nextTokenToTrade");
    return false;
  }
  if (
    !(
      stateObject["tradedTokens"] instanceof Array &&
      stateObject["tradedTokens"].every(
        (elt) => typeof elt === "string" && utils.isAddress(elt),
      )
    )
  ) {
    console.error("Invalid tradedTokens");
    return false;
  }
  if (
    !(
      stateObject["pendingTokens"] instanceof Array &&
      stateObject["pendingTokens"].every(
        (elt) =>
          elt !== null &&
          typeof elt === "object" &&
          typeof elt.address === "string" &&
          utils.isAddress(elt.address) &&
          typeof elt.retries === "number",
      )
    )
  ) {
    console.error("Invalid pendingTokens");
    return false;
  }
  return true;
}

interface WithdrawAndDumpInput {
  state: State;
  solver: SignerWithAddress;
  receiver: string;
  authenticator: Contract;
  settlement: Contract;
  settlementDeploymentBlock: number;
  latestBlock: number;
  minValue: string;
  leftover: string;
  validity: number;
  maxFeePercent: number;
  toToken: string;
  network: SupportedNetwork;
  usdReference: ReferenceToken;
  hre: HardhatRuntimeEnvironment;
  api: Api;
  dryRun: boolean;
}
export async function withdrawAndDump({
  state,
  solver,
  receiver,
  authenticator,
  settlement,
  settlementDeploymentBlock,
  latestBlock,
  minValue,
  leftover,
  validity,
  maxFeePercent,
  toToken,
  network,
  usdReference,
  hre,
  api,
  dryRun,
}: WithdrawAndDumpInput): Promise<State> {
  // Update list of pending tokens to determine which token was traded
  const pendingTokens = (
    await Promise.all(
      state.pendingTokens.map(async (pendingToken) => {
        if (pendingToken.retries >= MAX_ORDER_RETRIES_BEFORE_SKIPPING) {
          // Note that this error might be triggered in legitimate cases, for
          // example if a token did not trade the first time and then the price
          // has become so low that it's not enough to pay for the fee.
          // TODO: revisit after getting an idea of the frequency at which this
          // alert is triggered.
          console.error(
            `Tried ${pendingToken.retries} times to sell token ${pendingToken.address} without success. Skipping token until future run`,
          );
          return [];
        }

        // assumption: eth is not in the list (as it's not supported by the
        // withdraw script).
        const token = await erc20Token(pendingToken.address, hre);
        if (token === null) {
          throw new Error(
            `Previously sold a token that is not a valid ERC20 token anymore (address ${pendingToken.address})`,
          );
        }
        pendingToken.retries += 1;
        return (await balanceOf(token, solver.address)).isZero()
          ? []
          : [pendingToken];
      }),
    )
  ).flat();

  console.log("Recovering list of tokens traded since the previous run...");
  const recentlyTradedTokens = await getAllTradedTokens(
    settlement,
    state.lastUpdateBlock,
    latestBlock,
    hre,
  );

  const tradedTokens = state.tradedTokens.concat(
    recentlyTradedTokens.filter(
      (token) =>
        !(state.tradedTokens.includes(token) || token === BUY_ETH_ADDRESS),
    ),
  );
  const numCheckedTokens = Math.min(
    MAX_CHECKED_TOKENS_PER_RUN,
    tradedTokens.length,
  );
  // The index of the checked token wraps around after reaching the end of the
  // traded token list
  const checkedTokens = tradedTokens
    .concat(tradedTokens)
    .slice(state.nextTokenToTrade, state.nextTokenToTrade + numCheckedTokens);
  const updatedState: State = {
    lastUpdateBlock: latestBlock,
    tradedTokens,
    nextTokenToTrade:
      (state.nextTokenToTrade + numCheckedTokens) % tradedTokens.length,
    pendingTokens,
  };

  const withdrawnTokens = await withdraw({
    solver,
    tokens: checkedTokens,
    minValue,
    leftover,
    receiver: solver.address,
    authenticator,
    settlement,
    settlementDeploymentBlock,
    latestBlock,
    network,
    usdReference,
    hre,
    api,
    dryRun,
    doNotPrompt: true,
  });

  const tokensToDump = Array.from(
    new Set(pendingTokens.map((t) => t.address).concat(withdrawnTokens)),
  ).filter((addr) => addr !== BUY_ETH_ADDRESS);

  // wait for node to pick up updated balances
  await sleep(5000);

  await dump({
    validity,
    maxFeePercent,
    dumpedTokens: tokensToDump,
    toToken,
    settlement,
    signer: solver,
    receiver,
    network,
    hre,
    api,
    dryRun,
    doNotPrompt: true,
  });
  if (dryRun) {
    console.log(
      "Dry run: the amount withdrawn from the settlement contract are missing, only amounts that are already present at this address are shown.",
    );
  }

  updatedState.pendingTokens.push(
    ...tokensToDump
      .filter(
        (address) =>
          !updatedState.pendingTokens
            .map((pendingToken) => pendingToken.address)
            .includes(address),
      )
      .map((address) => ({ address, retries: 1 })),
  );
  assert(isValidState(updatedState), "Must generate a valid state");
  return updatedState;
}

const setupWithdrawServiceTask: () => void = () =>
  task("withdrawService", "Withdraw funds from the settlement contract")
    .addOptionalParam(
      "minValue",
      "If specified, sets a minimum USD value required to withdraw the balance of a token",
      "100",
      types.string,
    )
    .addOptionalParam(
      "leftover",
      "If specified, withdrawing leaves an amount of each token of USD value specified with this flag",
      "100",
      types.string,
    )
    .addOptionalParam(
      "toToken",
      "All input tokens will be dumped to this token. If not specified, it defaults to the network's native token (e.g., ETH)",
    )
    .addOptionalParam(
      "validity",
      `How long the sell orders will be valid after their creation in seconds. It cannot be larger than ${MAX_ORDER_VALIDITY_SECONDS}`,
      20 * 60,
      types.int,
    )
    .addOptionalParam(
      "maxFeePercent",
      "If, for any token, the amount of fee to be paid is larger than this percent of the traded amount, that token is not traded",
      5,
      types.float,
    )
    .addOptionalParam(
      "stateFilePath",
      "The path to the file where the state of the script is stored. This file will be updated after a run",
      "./state.json",
      types.string,
    )
    .addParam("receiver", "The address receiving the withdrawn tokens")
    .addFlag(
      "dryRun",
      "Just simulate the settlement instead of executing the transaction on the blockchain",
    )
    .setAction(
      async (
        {
          minValue,
          leftover,
          toToken,
          validity,
          maxFeePercent,
          stateFilePath,
          receiver: inputReceiver,
          dryRun,
        },
        hre: HardhatRuntimeEnvironment,
      ) => {
        const state = JSON.parse((await fs.readFile(stateFilePath)).toString());
        console.debug(`Initial state: ${JSON.stringify(state)}`);
        if (!isValidState(state)) {
          throw new Error("Invalid state file");
        }
        const network = hre.network.name;
        if (!isSupportedNetwork(network)) {
          throw new Error(`Unsupported network ${network}`);
        }
        const usdReference = REFERENCE_TOKEN[network];
        const api = new Api(network, Environment.Prod);
        const receiver = utils.getAddress(inputReceiver);
        const [
          authenticator,
          settlementDeployment,
          [solver],
          latestBlock,
        ] = await Promise.all([
          getDeployedContract("GPv2AllowListAuthentication", hre),
          hre.deployments.get("GPv2Settlement"),
          hre.ethers.getSigners(),
          hre.ethers.provider.getBlockNumber(),
        ]);
        const settlement = new Contract(
          settlementDeployment.address,
          settlementDeployment.abi,
        ).connect(hre.ethers.provider);
        const settlementDeploymentBlock =
          settlementDeployment.receipt?.blockNumber ?? 0;
        console.log(`Using account ${solver.address}`);

        const updatedState = await withdrawAndDump({
          state,
          solver,
          receiver,
          authenticator,
          settlement,
          settlementDeploymentBlock,
          latestBlock,
          minValue,
          leftover,
          validity,
          maxFeePercent,
          toToken,
          network,
          usdReference,
          hre,
          api,
          dryRun,
        });

        console.debug(`Updated state: ${JSON.stringify(updatedState)}`);
        if (!dryRun) {
          await fs.writeFile(
            stateFilePath,
            JSON.stringify(updatedState, undefined, 2),
          );
        }
      },
    );

export { setupWithdrawServiceTask };
