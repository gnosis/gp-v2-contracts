import { setupCopyArtifactsTask } from "./artifacts";
import { setupSolversTask } from "./solvers";
import { setupTenderlyTask } from "./tenderly";
import { setupWithdrawTask } from "./withdraw";

export function setupTasks(): void {
  setupCopyArtifactsTask();
  setupSolversTask();
  setupTenderlyTask();
  setupWithdrawTask();
}
