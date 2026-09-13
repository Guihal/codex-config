import { parentPort, workerData } from "node:worker_threads";
import { runColdForFiles } from "../lint-inject/cold-runner.ts";

try {
  const report = await runColdForFiles(workerData.items, undefined, () => {
    parentPort.postMessage({ type: "plans-resolved" });
  });
  parentPort.postMessage({ type: "report", report });
} catch (error) {
  parentPort.postMessage({ type: "error", error: error?.stack ?? String(error) });
}
