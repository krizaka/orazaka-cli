/**
 * @file runs.wait.ts
 * @description Follows one run until it ends or needs a person (orazaka-cli#90): `studio run` in the foreground,
 * `runs wait`, and the detached watcher behind `--background --notify`. The sleep is injected so tests run at once.
 */

import { StudioApi, type RunResponse } from "./studio.api";

const POLL_MS = 3000; // @fixed: a terminal refresh rate, not a business parameter

export type WaitOutcome = "finished" | "failed" | "cancelled" | "needs-approval";

export interface WaitResult {
  readonly outcome: WaitOutcome;
  readonly run: RunResponse;
}

export function outcomeOf(status: string): WaitOutcome | null {
  if (status === "AWAITING_INPUT") return "needs-approval";
  if (status === "SUCCEEDED") return "finished";
  if (status === "FAILED") return "failed";
  if (status === "CANCELLED") return "cancelled";
  return null;
}

/** Re-reads the run until it ends or waits for an answer; `onStatus` sees each distinct status. */
export async function waitForRun(
  runId: string,
  options: {
    readonly onStatus?: (status: string) => void;
    readonly sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<WaitResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last = "";
  for (;;) {
    const run = await StudioApi.runDetail(runId);
    if (run.status !== last) {
      last = run.status;
      options.onStatus?.(run.status);
    }
    const outcome = outcomeOf(run.status);
    if (outcome) return { outcome, run };
    await sleep(POLL_MS);
  }
}
