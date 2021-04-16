import { setupCopyArtifactsTask } from "./artifacts";
import { setupDecodeTask } from "./decode";
import { setupSolversTask } from "./solvers";
import { setupTenderlyTask } from "./tenderly";

export function setupTasks(): void {
  setupCopyArtifactsTask();
  setupDecodeTask();
  setupSolversTask();
  setupTenderlyTask();
}
