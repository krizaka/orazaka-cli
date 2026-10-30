/**
 * @file runs.command.ts
 * @description `orazaka runs` - the runs of the workspace as background tasks (ADR-088, orazaka-cli#90):
 * `runs ls [--watch] [--json]` and `runs show <name|id> [--steps] [--json]`. A run is addressed by its id or its
 * name (the server resolves both, ADR-088 point 1). `--watch` re-reads the list every few seconds; `runs stop|approve|resume` steer a run
 * through the endpoints the Studio serves; `send` and `deny` follow with theirs.
 */

import { Command } from "commander";
import chalk from "chalk";
import { requireAuth } from "../threads";
import { Logger } from "../ui/logger";
import { StudioApi } from "../services/studio.api";
import {
  normaliseRef,
  rowLine,
  sortRuns,
  timelineLines,
  toRow,
  costAgainstBudget,
  formatElapsed,
  type NamedRun,
} from "../services/runs.view";

const WATCH_INTERVAL_MS = 3000; // @fixed: a terminal refresh rate, not a business parameter

function fail(message: string, error: unknown): never {
  Logger.error(`${message}: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exit(1);
}

async function render(json: boolean): Promise<void> {
  const runs = sortRuns((await StudioApi.runs()) as NamedRun[]);
  const rows = runs.map((run) => toRow(run, new Date()));
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log(chalk.gray("No runs yet."));
    return;
  }
  console.log(
    chalk.bold(["NAME".padEnd(20), "STATUS".padEnd(10), "STEP".padEnd(18), "ELAPSED".padEnd(8), "COST"].join(" ")),
  );
  for (const row of rows) console.log(rowLine(row));
}

const lsCommand = new Command("ls")
  .alias("list")
  .description("List the runs: name, status, current step, elapsed time, cost against the budget")
  .option("--watch", "Refresh the list every few seconds")
  .option("--json", "Output the rows as JSON")
  .action(async (options: { watch?: boolean; json?: boolean }) => {
    requireAuth();
    try {
      await render(Boolean(options.json));
      if (options.watch) {
        setInterval(() => {
          if (!options.json) console.clear();
          render(Boolean(options.json)).catch(() => {});
        }, WATCH_INTERVAL_MS);
      }
    } catch (error: unknown) {
      fail("Could not list the runs", error);
    }
  });

const showCommand = new Command("show")
  .description("Show one run, by name or id")
  .argument("<ref>", "The run name or id")
  .option("--steps", "Show the folded timeline, one line per step")
  .option("--json", "Output the run as JSON")
  .action(async (ref: string, options: { steps?: boolean; json?: boolean }) => {
    requireAuth();
    try {
      const run = (await StudioApi.runDetail(normaliseRef(ref))) as NamedRun;
      if (options.json) {
        console.log(JSON.stringify({ ...toRow(run, new Date()), steps: run.steps ?? [] }, null, 2));
        return;
      }
      const row = toRow(run, new Date());
      console.log(`${chalk.bold(row.name ?? row.id)}  ${row.status}  ${row.studioKey}`);
      console.log(chalk.gray(`elapsed ${formatElapsed(row.elapsedSeconds)}, cost ${costAgainstBudget(row)}`));
      if (run.errorMessage) console.log(chalk.red(run.errorMessage));
      if (options.steps) for (const line of timelineLines(run)) console.log(line);
    } catch (error: unknown) {
      fail("Could not load the run", error);
    }
  });

/** The three steering actions the Studio serves today (cancel, approve, resume); send and deny wait for their endpoints. */
function steerCommand(name: string, description: string, done: string, call: (id: string) => Promise<unknown>) {
  return new Command(name)
    .description(description)
    .argument("<ref>", "The run name or id")
    .option("--json", "Output the result as JSON")
    .action(async (ref: string, options: { json?: boolean }) => {
      requireAuth();
      try {
        const id = normaliseRef(ref);
        const result = await call(id);
        if (options.json) console.log(JSON.stringify({ id, action: name, result: result ?? null }, null, 2));
        else console.log(done);
      } catch (error: unknown) {
        fail(`Could not ${name} the run`, error);
      }
    });
}

const stopCommand = steerCommand("stop", "Stop a run and release its hold", "stopped", (id) => StudioApi.cancelRun(id));
const approveCommand = steerCommand(
  "approve",
  "Approve the step a run is waiting on",
  "approved, the run continues",
  (id) => StudioApi.approveRun(id),
);

const resumeCommand = new Command("resume")
  .description("Start a new run from a step of a finished one; the steps before it keep their outputs")
  .argument("<ref>", "The run name or id")
  .requiredOption("--from <step>", "The step to run again")
  .option("--json", "Output the new run as JSON")
  .action(async (ref: string, options: { from: string; json?: boolean }) => {
    requireAuth();
    try {
      const run = (await StudioApi.resumeRun(normaliseRef(ref), options.from)) as NamedRun;
      if (options.json) console.log(JSON.stringify(toRow(run, new Date()), null, 2));
      else console.log(`resumed from ${options.from}: new run ${run.name ?? run.id}`);
    } catch (error: unknown) {
      fail("Could not resume the run", error);
    }
  });

export const runsCommand = new Command("runs")
  .description("Runs as background tasks: list and inspect them by name or id")
  .addCommand(lsCommand)
  .addCommand(showCommand)
  .addCommand(stopCommand)
  .addCommand(approveCommand)
  .addCommand(resumeCommand);
