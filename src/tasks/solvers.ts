import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";

import { Contract, Signer } from "ethers";
import { subtask, task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const solversTaskList = ["add", "check", "remove"] as const;
type SolversTasks = typeof solversTaskList[number];

async function getOwnerSigner({
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment): Promise<Signer> {
  const { manager } = await getNamedAccounts();
  const signer = (await ethers.getSigners()).find(
    (signer) => signer.address == manager,
  );
  if (signer == undefined) {
    throw new Error(
      'No owner found among the signers. Did you export the owner\'s private key with "export PK=<your key>"?',
    );
  }
  return signer;
}

async function getAuthenticator({
  ethers,
  deployments,
}: HardhatRuntimeEnvironment): Promise<Contract> {
  const authenticatorDeployment = await deployments.get(
    "GPv2AllowListAuthentication",
  );

  const authenticator = new Contract(
    authenticatorDeployment.address,
    authenticatorDeployment.abi,
  ).connect(ethers.provider);

  return authenticator;
}

async function addSolver(
  solver: string,
  hardhatRuntime: HardhatRuntimeEnvironment,
) {
  const owner = await getOwnerSigner(hardhatRuntime);
  const authenticator = await getAuthenticator(hardhatRuntime);

  const tx = await authenticator.connect(owner).addSolver(solver);
  await tx.wait();
  console.log("Solver added.");
}

const removeSolver = async (
  solver: string,
  hardhatRuntime: HardhatRuntimeEnvironment,
) => {
  const owner = await getOwnerSigner(hardhatRuntime);
  const authenticator = await getAuthenticator(hardhatRuntime);

  const tx = await authenticator.connect(owner).removeSolver(solver);
  await tx.wait();
  console.log("Solver removed.");
};

const isSolver = async (
  solver: string,
  hardhatRuntime: HardhatRuntimeEnvironment,
) => {
  const authenticator = await getAuthenticator(hardhatRuntime);

  console.log(
    `${solver} is ${
      (await authenticator.isSolver(solver)) ? "" : "NOT "
    }a solver.`,
  );
};

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
    "Checks that an address is registered as a solver in GPv2.",
  ).setAction(async ({ args }, hardhatRuntime) => {
    if (!args || args.length !== 1) {
      throw new Error(
        "Invalid number of arguments. Expected the address of the solver to be checked",
      );
    }
    await isSolver(args[0], hardhatRuntime);
  });
};

export { setupSolversTask };
