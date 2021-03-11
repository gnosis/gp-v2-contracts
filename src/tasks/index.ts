import { setupCopyArtifactsTask } from "./artifacts";
import { setupSolversTask } from "./solvers";
import { setupTenderlyTask } from "./tenderly";

export function setupTasks(): void {
  setupCopyArtifactsTask();
  setupSolversTask();
  setupTenderlyTask();
}
