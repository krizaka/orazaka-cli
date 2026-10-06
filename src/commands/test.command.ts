/**
 * @file test.command.ts
 * @description `orazaka test [unit|it|e2e]` — single entry point for the test
 * pyramid (AGENTS.md §1, §9). Maps each tier to the Maven profile matrix
 * (ADR-040): unit → surefire, it → failsafe/Testcontainers, e2e → the hermetic
 * end-to-end orchestration under the `staging` profile.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { intro, outro, note, logWarning } from "../ui/prompts";

/** The supported test tiers. */
type TestMode = "unit" | "it" | "e2e" | "worker";

const MODES: readonly TestMode[] = ["unit", "it", "e2e", "worker"] as const;

/** Maven invocation per tier. The heavy E2E module is excluded from unit/it. */
const MAVEN_ARGS: Record<TestMode, readonly string[]> = {
  unit: ["test", "-pl", "!orazaka-end2end"],
  it: ["verify", "-pl", "!orazaka-end2end"],
  e2e: ["verify", "-P", "staging"],
  // `worker` does not go through Maven — see runWorkerGate below.
  worker: [],
};

const DESCRIPTIONS: Record<TestMode, string> = {
  unit: "Unit tests (surefire) across every module except the E2E suite",
  it: "Integration tests (failsafe / Testcontainers) across the framework + apps",
  e2e: "Hermetic end-to-end orchestration (infra + router + Playwright, staging profile)",
  worker: "Python media worker: ruff lint + pytest (the Maven reactor excludes it by design)",
};

/** Resolves the orazaka monorepo root (where `./mvnw` lives) from this file. */
function resolveMonorepoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..", "..", "..");
}

function isTestMode(value: string): value is TestMode {
  return (MODES as readonly string[]).includes(value);
}

export const testCommand = new Command("test")
  .description("Run the test pyramid: unit | it (Testcontainers) | e2e (hermetic)")
  .argument("[mode]", `test tier to run (${MODES.join(" | ")})`, "unit")
  .action((mode: string) => {
    const tier = mode.toLowerCase();
    if (!isTestMode(tier)) {
      logWarning(`Unknown test mode "${mode}". Use one of: ${MODES.join(", ")}.`);
      process.exitCode = 1;
      return;
    }

    const root = resolveMonorepoRoot();

    if (tier === "worker") {
      runWorkerGate(root);
      return;
    }

    const args = [...MAVEN_ARGS[tier]];
    const mvnw = process.platform === "win32" ? "mvnw.cmd" : "./mvnw";

    intro(chalk.cyan(`orazaka test ${tier}`));
    note(`${DESCRIPTIONS[tier]}\n\n${chalk.gray("$")} ${mvnw} ${args.join(" ")}`, "Maven");

    const result = spawnSync(mvnw, args, { cwd: root, stdio: "inherit", shell: false });

    if (result.status === 0) {
      outro(chalk.green(`✔ test ${tier} — green`));
      return;
    }
    logWarning(`test ${tier} failed (exit ${result.status ?? result.signal ?? "unknown"})`);
    process.exitCode = result.status ?? 1;
  });

/**
 * Lint and test the Python media worker.
 *
 * Outside Maven on purpose — the reactor excludes this module because it is a Python project, and
 * that is a sound reason not to hand it to javac. It is not a reason to leave 1 490 lines with no
 * linter and 41 tests nothing runs, in the one component that writes to disk outside the database.
 *
 * Uses the module's own virtualenv rather than a system Python, so the gate runs against the
 * interpreter the worker actually executes under.
 */
function runWorkerGate(root: string): void {
  const worker = path.join(root, "orazaka-apps", "workers", "orazaka-worker-media");
  const bin = path.join(worker, ".venv", "bin");

  if (!fs.existsSync(path.join(bin, "ruff"))) {
    logWarning(
      "The worker virtualenv has no ruff/pytest. Run:\n" +
        `  ${path.join(bin, "python")} -m pip install ruff pytest`,
    );
    process.exitCode = 1;
    return;
  }

  for (const [label, cmd, args] of [
    ["ruff", path.join(bin, "ruff"), ["check", "."]],
    ["pytest", path.join(bin, "pytest"), []],
  ] as const) {
    note(`${chalk.gray("$")} ${label} ${args.join(" ")}`, "Python worker");
    const result = spawnSync(cmd, [...args], { cwd: worker, stdio: "inherit", shell: false });
    if (result.status !== 0) {
      logWarning(`worker ${label} failed`);
      process.exitCode = result.status ?? 1;
      return;
    }
  }
  outro(chalk.green("✔ worker — green"));
}
