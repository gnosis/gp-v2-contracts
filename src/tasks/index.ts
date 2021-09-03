import { setupCopyArtifactsTask } from "./artifacts";
import { setupDecodeTask } from "./decode";
import { setupSolversTask } from "./solvers";
import { setupTenderlyTask } from "./tenderly";
import { setupTransferOwnershipTask } from "./transferOwnership";
import { setupWithdrawTask } from "./withdraw";

export function setupTasks(): void {
  setupCopyArtifactsTask();
  setupDecodeTask();
  setupSolversTask();
  setupTenderlyTask();
  setupTransferOwnershipTask();
  setupWithdrawTask();
}
