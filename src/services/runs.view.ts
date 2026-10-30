/**
 * @file runs.view.ts
 * @description Pure shaping of Studio runs for `orazaka runs` (ADR-088, orazaka-cli#90): one row per run, the
 * folded timeline of a run, and the stable `--json` shapes. No I/O here, so it is tested without a server.
 */

import type { RunResponse, RunStepResponse } from "./studio.api";

/** A run as the CLI lists it; `name` and `cost` appear once the Studio serves them (ADR-088 slices A and D). */
export type NamedRun = RunResponse & {
  readonly name?: string | null;
  readonly cost?: number | null;
  readonly budget?: number | null;
};

export interface RunRow {
  readonly id: string;
  readonly name: string | null;
  readonly studioKey: string;
  readonly status: string;
  readonly currentStep: string | null;
  readonly elapsedSeconds: number;
  readonly cost: number | null;
  readonly budget: number | null;
}

const ACTIVE_STEP = new Set(["RUNNING", "PENDING", "QUEUED", "WAITING"]);

export function elapsedSeconds(run: Pick<RunResponse, "startedAt" | "finishedAt">, now: Date): number {
  const end = run.finishedAt ? new Date(run.finishedAt) : now;
  return Math.max(0, Math.round((end.getTime() - new Date(run.startedAt).getTime()) / 1000));
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${String(Math.floor(minutes / 60))}h${String(minutes % 60).padStart(2, "0")}m`;
}

export function currentStep(steps: readonly RunStepResponse[]): string | null {
  return steps.find((step) => ACTIVE_STEP.has(step.status))?.stepId ?? null;
}

export function toRow(run: NamedRun, now: Date): RunRow {
  return {
    id: run.id,
    name: run.name ?? null,
    studioKey: run.studioKey,
    status: run.status,
    currentStep: currentStep(run.steps ?? []),
    elapsedSeconds: elapsedSeconds(run, now),
    cost: run.cost ?? null,
    budget: run.budget ?? null,
  };
}

export function costAgainstBudget(row: Pick<RunRow, "cost" | "budget">): string {
  if (row.cost === null) return "-";
  const spent = `$${row.cost.toFixed(2)}`;
  return row.budget === null ? spent : `${spent} / $${row.budget.toFixed(2)}`;
}

/** Newest first, like the web console. */
export function sortRuns(runs: readonly NamedRun[]): NamedRun[] {
  return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function rowLine(row: RunRow): string {
  const label = row.name ?? row.id.slice(0, 8);
  return [
    label.padEnd(20),
    row.status.padEnd(10),
    (row.currentStep ?? "-").padEnd(18),
    formatElapsed(row.elapsedSeconds).padEnd(8),
    costAgainstBudget(row),
  ].join(" ");
}

/** The folded timeline, one line per step: ordinal, status, step id, job. */
export function timelineLines(run: RunResponse): string[] {
  return (run.steps ?? []).map((step) => {
    const fanOut = step.ordinal > 0 ? ` #${String(step.ordinal + 1)}` : "";
    const job = step.jobId ? ` job ${step.jobId}` : "";
    const error = step.error ? ` - ${step.error}` : "";
    return `${step.status.padEnd(10)} ${step.stepId}${fanOut}${job}${error}`;
  });
}

/** A run is addressed by its id or by its name; the server resolves it, the CLI only refuses an empty ref. */
export function normaliseRef(ref: string): string {
  const trimmed = ref.trim();
  if (trimmed === "") throw new Error("A run name or id is required");
  return trimmed;
}
