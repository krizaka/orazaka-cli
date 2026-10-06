/**
 * @file studio.command.ts
 * @description `orazaka studio` — browse, install and run installable business workflows (ADR-034).
 *
 * The CLI surface of the marketplace. It exists because a Studio run is a first-class
 * operation of the platform, not a web-only feature: the same REST surface the browser
 * uses is reachable from a terminal, and a professional automating their week should not
 * need a tab open.
 */

import { Command } from "commander";
import chalk from "chalk";
import { requireAuth } from "../threads";
import { createSpinner } from "../ui/prompts";
import { Box } from "../ui/box";
import { Logger } from "../ui/logger";
import { StudioApi } from "../services/studio.api";

/** Turns `k=v,k2=v2` into an object. The CLI's one concession to terseness. */
function parsePairs(raw?: string): Record<string, string> {
  if (!raw) {
    return {};
  }
  const parsed: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const separator = pair.indexOf("=");
    if (separator > 0) {
      parsed[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
    }
  }
  return parsed;
}

/** Inputs additionally split comma-lists into arrays, which is what a fan-out needs. */
function parseInputs(raw?: string): Record<string, unknown> {
  const flat = parsePairs(raw);
  const inputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    inputs[key] = value.includes("|") ? value.split("|").map((item) => item.trim()) : value;
  }
  return inputs;
}

function fail(message: string, error: unknown): never {
  const detail = error instanceof Error ? error.message : "Unknown error";
  Logger.error(`${message}: ${detail}`);
  process.exit(1);
}

const listCommand = new Command("list")
  .description("Browse the Studio catalogue")
  .option("-p, --profession <trade>", "Filter by trade")
  .action(async (options: { profession?: string }) => {
    requireAuth();
    const spinner = await createSpinner();
    spinner.start("Loading the Studio catalogue...");
    try {
      const studios = await StudioApi.list(options.profession);
      spinner.stop(`${studios.length} Studio(s)`);

      const items: string[] = [];
      for (const studio of studios) {
        // A locked Studio is listed, not hidden: the terminal is a funnel too.
        const state = studio.locked
          ? chalk.yellow(`○ ${studio.lockedReason}`)
          : chalk.green("● available");
        items.push(`${state} ${chalk.bold(studio.label)} (${studio.studioKey})`);
        if (studio.tagline) {
          items.push(`           ${chalk.gray(studio.tagline)}`);
        }
        items.push(
          `           ${chalk.gray(`${studio.profession} · ${studio.pricing} · ${studio.latestVersion ?? "unpublished"}`)}`,
        );
      }
      if (items.length === 0) {
        items.push("No Studio matches that trade yet.");
      }
      Box.render("🎬 ORAZAKA STUDIOS", items, { borderColor: "cyan", titleColor: "white" });
    } catch (error: unknown) {
      spinner.stop("Failed to load the catalogue");
      fail("Failed to load the Studio catalogue", error);
    }
  });

const installedCommand = new Command("installed")
  .description("List the Studios you have installed")
  .action(async () => {
    requireAuth();
    const spinner = await createSpinner();
    spinner.start("Loading your Studios...");
    try {
      const installations = await StudioApi.installations();
      spinner.stop(`${installations.length} installed`);

      const items: string[] = [];
      for (const installation of installations) {
        const upgrade =
          installation.status === "UPGRADE_AVAILABLE"
            ? chalk.yellow(` ⤴ ${installation.latestVersion} available`)
            : "";
        items.push(
          `${chalk.bold(installation.label)} (${installation.studioKey}) @ ${installation.pinnedVersion}${upgrade}`,
        );
        items.push(`           ${chalk.gray(installation.id)}`);
      }
      if (items.length === 0) {
        items.push("Nothing installed yet — try `orazaka studio list`.");
      }
      Box.render("🎬 MY STUDIOS", items, { borderColor: "cyan", titleColor: "white" });
    } catch (error: unknown) {
      spinner.stop("Failed to load your Studios");
      fail("Failed to load your installations", error);
    }
  });

const installCommand = new Command("install")
  .description("Install a Studio into your workspace")
  .argument("<studioKey>", "The Studio to install")
  .option("-c, --config <pairs>", "Configuration as key=value,key2=value2")
  .action(async (studioKey: string, options: { config?: string }) => {
    requireAuth();
    const spinner = await createSpinner();
    spinner.start(`Installing ${studioKey}...`);
    try {
      const installation = await StudioApi.install(studioKey, parsePairs(options.config));
      spinner.stop(`Installed ${installation.label}`);
      Logger.info(`Installation id: ${installation.id}`);
      Logger.info(`Pinned version : ${installation.pinnedVersion}`);
    } catch (error: unknown) {
      spinner.stop("Install refused");
      // A refusal here is usually a 409 naming the package to buy — surfacing the
      // server's message verbatim keeps the upsell intact instead of flattening it.
      fail(`Could not install ${studioKey}`, error);
    }
  });

const runCommand = new Command("run")
  .description("Run an installed Studio")
  .argument("<installationId>", "The installation to run")
  .option("-i, --inputs <pairs>", "Inputs as key=value,key2=a|b|c (pipes make a list)")
  .action(async (installationId: string, options: { inputs?: string }) => {
    requireAuth();
    const spinner = await createSpinner();
    spinner.start("Starting the run...");
    try {
      const run = await StudioApi.run(installationId, parseInputs(options.inputs));
      spinner.stop(`Run ${run.status.toLowerCase()}`);
      Logger.info(`Run id: ${run.id}`);
      Logger.info(`Follow it with: orazaka studio logs ${run.id}`);
    } catch (error: unknown) {
      spinner.stop("Run refused");
      fail("Could not start the run", error);
    }
  });

const logsCommand = new Command("logs")
  .description("Show a run's per-step state and results")
  .argument("<runId>", "The run to inspect")
  .action(async (runId: string) => {
    requireAuth();
    const spinner = await createSpinner();
    spinner.start("Loading the run...");
    try {
      const run = await StudioApi.runDetail(runId);
      spinner.stop(`Run ${run.status}`);

      const items: string[] = [
        `${chalk.bold(run.studioKey)} @ ${run.blueprintVersion} — ${run.status}`,
      ];
      for (const step of run.steps) {
        const tone =
          step.status === "SUCCEEDED"
            ? chalk.green
            : step.status === "FAILED"
              ? chalk.red
              : chalk.gray;
        const fanOut = step.ordinal > 0 ? ` #${step.ordinal + 1}` : "";
        items.push(`${tone(`● ${step.status.padEnd(9)}`)} ${step.stepId}${fanOut}`);
        if (step.error) {
          items.push(`           ${chalk.red(step.error)}`);
        }
        if (step.jobId) {
          items.push(`           ${chalk.gray(`job ${step.jobId}`)}`);
        }
      }
      for (const artefact of run.outputs ?? []) {
        items.push(`${chalk.cyan("→")} ${chalk.bold(artefact.label)}: ${artefact.value}`);
      }
      if (run.errorMessage) {
        items.push(chalk.red(run.errorMessage));
      }
      Box.render("🎬 STUDIO RUN", items, { borderColor: "cyan", titleColor: "white" });
    } catch (error: unknown) {
      spinner.stop("Failed to load the run");
      fail("Could not load the run", error);
    }
  });

export const studioCommand = new Command("studio")
  .description("Browse, install and run installable business workflows")
  .addCommand(listCommand)
  .addCommand(installedCommand)
  .addCommand(installCommand)
  .addCommand(runCommand)
  .addCommand(logsCommand);
