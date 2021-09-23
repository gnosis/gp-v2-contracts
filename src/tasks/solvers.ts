import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";

import { subtask, task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getDeployedContract } from "./ts/deployment";
import { getNamedSigner } from "./ts/signers";
import { getSolvers } from "./ts/solver";

const solversTaskList = ["add", "check", "remove", "list"] as const;
type SolversTasks = typeof solversTaskList[number];

async function addSolver(solver: string, hre: HardhatRuntimeEnvironment) {
  const owner = await getNamedSigner(hre, "manager");
  const authenticator = await getDeployedContract(
    "GPv2AllowListAuthentication",
    hre,
  );

  const tx = await authenticator.connect(owner).addSolver(solver);
  await tx.wait();
  console.log("Solver added.");
}

const removeSolver = async (solver: string, hre: HardhatRuntimeEnvironment) => {
  const owner = await getNamedSigner(hre, "manager");
  const authenticator = await getDeployedContract(
    "GPv2AllowListAuthentication",
    hre,
  );

  const tx = await authenticator.connect(owner).removeSolver(solver);
  await tx.wait();
  console.log("Solver removed.");
};

const isSolver = async (solver: string, hre: HardhatRuntimeEnvironment) => {
  const authenticator = await getDeployedContract(
    "GPv2AllowListAuthentication",
    hre,
  );

  console.log(
    `${solver} is ${
      (await authenticator.isSolver(solver)) ? "" : "NOT "
    }a solver.`,
  );
};

async function listSolvers(hre: HardhatRuntimeEnvironment) {
  const authenticator = await getDeployedContract(
    "GPv2AllowListAuthentication",
    hre,
  );

  console.log((await getSolvers(authenticator)).join("\n"));
}

const setupSolversTask: () => void = () => {
  task("solvers", "Reads and changes the list of allowed solvers in GPv2.")
    .addPositionalParam<SolversTasks>(
      "subtask",
      `The action to execute on the authenticator. Allowed subtasks: ${solversTaskList.join(
        ", ",
      )}`,
    )
    .addOptionalVariadicPositionalParam(
      "args",
      "Extra parameters of the subtask",
    )
    .setAction(async (taskArguments, { run }) => {
      const { subtask } = taskArguments;
      if (solversTaskList.includes(subtask)) {
        delete taskArguments.subtask;
        await run(`solvers-${subtask}`, taskArguments);
      } else {
        throw new Error(`Invalid solver subtask ${subtask}.`);
      }
    });

  subtask(
    "solvers-add",
    "Adds a solver to the list of allowed solvers in GPv2.",
  ).setAction(async ({ args }, hardhatRuntime) => {
    if (!args || args.length !== 1) {
      throw new Error(
        "Invalid number of arguments. Expected the address of the solver to be added.",
      );
    }
    await addSolver(args[0], hardhatRuntime);
  });

  subtask(
    "solvers-remove",
    "Removes a solver from the list of allowed solvers in GPv2.",
  ).setAction(async ({ args }, hardhatRuntime) => {
    if (!args || args.length !== 1) {
      throw new Error(
        "Invalid number of arguments. Expected the address of the solver to be removed.",
      );
    }
    await removeSolver(args[0], hardhatRuntime);
  });

  subtask(
    "solvers-check",
    "Checks that an address is registered as a solver of GPv2.",
  ).setAction(async ({ args }, hardhatRuntime) => {
    if (!args || args.length !== 1) {
      throw new Error(
        "Invalid number of arguments. Expected the address of the solver to be checked",
      );
    }
    await isSolver(args[0], hardhatRuntime);
  });

  subtask(
    "solvers-list",
    "List all currently registered solvers of GPv2.",
  ).setAction(async (_, hardhatRuntime) => {
    await listSolvers(hardhatRuntime);
  });
};

export { setupSolversTask };
