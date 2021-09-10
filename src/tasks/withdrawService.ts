import "@nomiclabs/hardhat-ethers";

import { promises as fs, constants as fsConstants } from "fs";

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

export interface WithdrawAndDumpInput {
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
  confirmationsAfterWithdrawing?: number | undefined;
  pagination?: number | undefined;
}
/**
 * This function withdraws funds from the settlement contracts and puts the
 * withdrawn amount up for trade in GPv2 in exchange for a target token. The
 * proceeds are sent to a receiver address.
 *
 * This function is supposed to be called regularly and only a portion of the
 * possible withdraws are performed at a time. This is done in order not to
 * stress the infrastructure with too many simultaneous requests (node calls,
 * api queries, orders).
 * Because of this, the withdraw processing works based on a state containing
 * information on which tokens should be withdrawn next. The output of this
 * function is the updated state.
 *
 * The process comprises two steps:
 * 1. funds are withdrawn from the settlement contract to the solver
 * 2. orders are signed by the solver to sell these funds
 * This function inherit some of the parameters used in each intermediate step.
 */
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
  confirmationsAfterWithdrawing,
  pagination,
}: WithdrawAndDumpInput): Promise<State> {
  if (pagination === undefined) {
    pagination = MAX_CHECKED_TOKENS_PER_RUN;
  } else if (pagination > MAX_CHECKED_TOKENS_PER_RUN) {
    throw new Error(
      `Too many tokens checked per run (${pagination}, max ${MAX_CHECKED_TOKENS_PER_RUN})`,
    );
  }
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
        // withdraw script). This should not happen unless the pending token
        // list in the state was manually changed and ETH was added.
        assert(
          pendingToken.address.toLowerCase() !== BUY_ETH_ADDRESS.toLowerCase(),
          "Pending tokens should not contain ETH",
        );
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
  const numCheckedTokens = Math.min(pagination, tradedTokens.length);
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
    // Wait for node to pick up updated balances before running the dump
    // function
    requiredConfirmations: confirmationsAfterWithdrawing,
  });

  const tokensToDump = Array.from(
    new Set(pendingTokens.map((t) => t.address).concat(withdrawnTokens)),
  ).filter((addr) => addr !== BUY_ETH_ADDRESS);

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
  if (!isValidState(updatedState)) {
    console.log("Generated state:", updatedState);
    throw new Error("Withdraw service did not generate a valid state");
  }
  return updatedState;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path, fsConstants.F_OK);
    return true;
  } catch (e) {
    return false;
  }
}

async function getState(stateFilePath: string): Promise<State> {
  let state: State;
  if (!(await fileExists(stateFilePath))) {
    console.debug("No state found, using empty state");
    state = {
      lastUpdateBlock: 0,
      tradedTokens: [],
      nextTokenToTrade: 0,
      pendingTokens: [],
    };
  } else {
    console.debug(`Loading state from ${stateFilePath}...`);
    state = JSON.parse((await fs.readFile(stateFilePath)).toString());
  }
  if (!isValidState(state)) {
    console.error(`Bad initial state: ${JSON.stringify(state)}`);
    throw new Error("Invalid state detect");
  }
  return state;
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
    .addOptionalParam(
      "tokensPerRun",
      `The maximum number of tokens to process in a single withdraw run. Must be smaller than ${MAX_CHECKED_TOKENS_PER_RUN}`,
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
          tokensPerRun,
        },
        hre: HardhatRuntimeEnvironment,
      ) => {
        const state = await getState(stateFilePath);
        console.debug(`Initial state: ${JSON.stringify(state)}`);
        const network = hre.network.name;
        if (!isSupportedNetwork(network)) {
          throw new Error(`Unsupported network ${network}`);
        }
        const usdReference = REFERENCE_TOKEN[network];
        const api = new Api(network, Environment.Prod);
        const receiver = utils.getAddress(inputReceiver);
        const [authenticator, settlementDeployment, [solver], latestBlock] =
          await Promise.all([
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
          confirmationsAfterWithdrawing: 2,
          pagination: tokensPerRun,
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
