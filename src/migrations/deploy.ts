import { promises as fs } from "fs";
import path from "path";

import hardhat from "hardhat";
import type { Network } from "hardhat/types";

const buildFolder = path.join("build", "deployed");
const migrationsFolder = path.join("src", "migrations");

// TODO: add test to catch file moving to different folder
const repoPath = path.dirname(path.dirname(__dirname));

export type Migration = (deployer: null, network: Network) => Promise<void>;

/**
 * State of contract deployment on a specific chain.
 */
interface DeploymentInfo {
  step: number;
}

function isValidDeploymentInfo(object: unknown): boolean {
  if (typeof object !== "object" || object === null) {
    return false;
  }
  if (typeof (object as DeploymentInfo).step !== "number") {
    return false;
  }
  return true;
}

class DeploymentState {
  private static readonly buildPath = path.join(repoPath, buildFolder);
  private static readonly statePath = path.join(
    DeploymentState.buildPath,
    "deployment.json",
  );
  private stateFileContent: Record<string, unknown> = {};
  step: number;

  private constructor(
    deploymentInfo: DeploymentInfo,
    private readonly network: string,
  ) {
    this.step = deploymentInfo.step;
  }

  private static defaults(): DeploymentInfo {
    return {
      step: 0,
    };
  }

  static async readFromFile(network: string): Promise<DeploymentState> {
    let stateFileContent;
    try {
      const fileContent = await fs.readFile(DeploymentState.statePath, "utf8");
      stateFileContent = JSON.parse(fileContent);
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log("Setting up repo for first migration...");

        await fs.mkdir(DeploymentState.buildPath, { recursive: true });
        stateFileContent = {};
      } else {
        throw error;
      }
    }

    if (typeof stateFileContent !== "object" || stateFileContent === null) {
      throw new Error("Invalid deployment state file");
    }

    if (stateFileContent[network] === undefined) {
      console.log(`First migration onto network ${network}.`);
      stateFileContent[network] = DeploymentState.defaults();
    } else if (!isValidDeploymentInfo(stateFileContent[network])) {
      throw new Error(
        `Invalid deployment state from file for network ${network}`,
      );
    }
    const deploymentState = new DeploymentState(
      stateFileContent[network] as DeploymentInfo,
      network,
    );
    deploymentState.stateFileContent = stateFileContent;
    return deploymentState;
  }

  private toDeploymentInfo(): DeploymentInfo {
    return {
      step: this.step,
    };
  }

  async writeToFile(): Promise<void> {
    this.stateFileContent[this.network] = this.toDeploymentInfo();
    await fs.writeFile(
      DeploymentState.statePath,
      JSON.stringify(this.stateFileContent, undefined, 2),
    );
  }
}

function filenameToStepNumber(filename: string): number | null {
  const match = filename.match(/^([[1-9][0-9]*)_/);
  return match === null ? null : Number.parseInt(match[1]);
}

/**
 * Returns a sorted list of migration functions.
 */
async function retrieveMigrationScripts(fromIndex = 1): Promise<Migration[]> {
  const migrationsPath = path.join(repoPath, migrationsFolder);
  const objectInMigrationFolder = await fs.readdir(migrationsPath);

  const isFile = await Promise.all(
    objectInMigrationFolder.map(async (file) => {
      return (await fs.stat(path.join(migrationsPath, file))).isFile();
    }),
  );
  const filesInMigrationFolder = objectInMigrationFolder.filter(
    (_, index) => isFile[index],
  );

  const indexedMigrations = filesInMigrationFolder
    .map((file) => <[number, string]>[filenameToStepNumber(file), file])
    .filter(([index]) => index !== null && index >= fromIndex)
    .sort((left, right) => left[0] - right[0]);

  // migration script numbering must start from one and not have any gaps.
  let count = fromIndex;
  if (!indexedMigrations.every(([index]) => index === count++)) {
    throw new Error(`Migration script at step ${count - 1} is missing`);
  }

  const migrations = await Promise.all(
    indexedMigrations.map(
      async ([, file]) => await import(path.join(migrationsPath, file)),
    ),
  );

  return migrations.map(({ default: imported }, index) => {
    if (typeof imported !== "function") {
      throw new Error(`Invalid migration script at step ${index + 1}`);
    }
    return imported;
  });
}

async function main() {
  const network = hardhat.network.name;
  const state = await DeploymentState.readFromFile(network);

  const fromIndex = state.step + 1;
  const migrations = await retrieveMigrationScripts(fromIndex);

  switch (migrations.length) {
    case 0: {
      console.log(
        `Nothing to migrate, contracts are up to date on ${network}.`,
      );
      break;
    }
    case 1: {
      console.log(`Executing migration ${fromIndex} on network ${network}.`);
      break;
    }
    default: {
      console.log(
        `Executing migrations from ${fromIndex} to ${
          fromIndex + migrations.length - 1
        } on network ${network}.`,
      );
      break;
    }
  }

  for (let i = 0; i < migrations.length; i++) {
    const element = migrations[i];
    try {
      await element(null, hardhat.network);
    } catch (error) {
      console.error(
        `Migration failure encountered at step ${
          state.step + i + 1
        }, stopping.`,
      );
      state.step += i;
      await state.writeToFile();
      throw error;
    }
  }

  state.step += migrations.length;
  await state.writeToFile();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
