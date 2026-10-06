/**
 * @file pack.command.ts
 * @description `orazaka pack` — validate, install and publish pack bundles (ADR-037, seam S4).
 *
 * The operator's half of the pack manifest. `validate` reads a bundle and checks it, which is
 * the loop a pack author runs; `install` applies it; `publish` puts an installed pack on the
 * shelf. Everything the platform learns about a pack arrives through this command, which is
 * what makes "a new pack is a bundle, not a deploy" true rather than aspirational.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { requireAuth } from "../threads";
import { createSpinner } from "../ui/prompts";
import { Logger } from "../ui/logger";
import { PackApi } from "../services/pack.api";
import { loadBundle, BundleError, type PackBundle } from "../services/pack.bundle";
import { discoverBundles, packSources } from "../services/pack.sources";

function fail(message: string, error: unknown): never {
  const detail = error instanceof Error ? error.message : "Unknown error";
  Logger.error(`${message}: ${detail}`);
  process.exit(1);
}

/**
 * Reads a bundle and stops on a shape problem.
 *
 * Shape is checked locally against `pack.schema.json` because a pack author must be able to fix
 * a malformed manifest without a platform running. What needs the platform — do these
 * capabilities resolve here — is the service's half, and is reported separately.
 */
function readOrExit(directory: string): PackBundle {
  try {
    const { bundle, problems } = loadBundle(directory);
    if (problems.length > 0) {
      Logger.error(`${path.basename(directory)}/pack.yaml does not match pack.schema.json:`);
      for (const problem of problems) {
        console.log(`  ${chalk.red("✗")} ${problem}`);
      }
      process.exit(1);
    }
    return bundle;
  } catch (error) {
    if (error instanceof BundleError) {
      Logger.error(error.message);
      process.exit(1);
    }
    return fail("Could not read the bundle", error);
  }
}

/** Prints what a bundle contains, so `validate` says something useful when it passes. */
function summarise(bundle: PackBundle): void {
  const shelf = bundle.catalog ? chalk.cyan(bundle.key) : chalk.dim("(no pack row)");
  console.log(`  ${chalk.bold(bundle.key)} v${bundle.version}  ${chalk.dim(bundle.tier)}  ${shelf}`);
  for (const studio of bundle.studios) {
    console.log(
      `    ${chalk.green("•")} ${studio.key} ${chalk.dim(
        `${studio.pricing} · blueprint ${studio.blueprint.version} · ${studio.blueprint.estimatedCredits} credits`,
      )}`,
    );
  }
  const locales = Object.keys(bundle.translations);
  console.log(
    `    ${chalk.dim(
      `${bundle.capabilities.length} contributed capability(ies) · locales: ${
        locales.length > 0 ? locales.join(", ") : "none"
      }`,
    )}`,
  );
}

const validateCommand = new Command("validate")
  .description("Check a bundle's manifest, and whether this platform can run it")
  .argument("<directory>", "The bundle directory holding pack.yaml")
  .option("--offline", "Check the manifest's shape only, without asking the platform")
  .action(async (directory: string, options: { offline?: boolean }) => {
    const bundle = readOrExit(directory);
    Logger.success(`${path.basename(directory)}/pack.yaml matches pack.schema.json`);
    summarise(bundle);

    if (options.offline) {
      console.log(chalk.dim("\n  --offline: capability resolution not checked."));
      return;
    }

    requireAuth();
    const spinner = await createSpinner();
    spinner.start("Checking capabilities against the platform...");
    try {
      const result = await PackApi.validate(bundle);
      if (result.valid) {
        spinner.stop("Every capability this bundle names resolves here.");
        return;
      }
      spinner.stop("This platform cannot run the bundle as written:");
      for (const problem of result.problems) {
        console.log(`  ${chalk.red("✗")} ${problem}`);
      }
      process.exit(1);
    } catch (error) {
      spinner.stop("Validation failed");
      fail("Could not reach the platform (use --offline to check the manifest alone)", error);
    }
  });

/** Every immediate subdirectory that holds a pack.yaml. A bundle is a directory with a manifest. */
function bundleDirectories(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((directory) => fs.existsSync(path.join(directory, "pack.yaml")))
    .sort();
}

const installCommand = new Command("install")
  .description("Install a bundle: capabilities, billing and catalogue, or none of them")
  .argument("<directory>", "The bundle directory holding pack.yaml, or a directory of bundles with --all")
  .option("--all", "Install every bundle in the directory — what a fresh database needs")
  .action(async (directory: string, options: { all?: boolean }) => {
    // Read and check EVERY bundle before installing ANY of them. Each install is atomic on its
    // own, but a run of three that stops after two leaves a catalogue nobody planned; a manifest
    // typo in the third should cost nothing rather than half a shelf.
    const directories = options.all ? bundleDirectories(directory) : [directory];
    if (directories.length === 0) {
      Logger.error(`No bundles in ${directory} (a bundle is a directory holding pack.yaml).`);
      process.exit(1);
    }
    const bundles = directories.map((bundleDir) => readOrExit(bundleDir));

    requireAuth();
    for (const bundle of bundles) {
      const spinner = await createSpinner();
      spinner.start(`Installing ${bundle.key} v${bundle.version}...`);
      try {
        const result = await PackApi.install(bundle);
        spinner.stop(
          `Installed ${chalk.bold(result.packKey)} v${result.version} — ${result.studiosInstalled} Studio(s).`,
        );
        summarise(bundle);
      } catch (error) {
        spinner.stop("Install failed");
        fail(`${bundle.key} was not installed`, error);
      }
    }
  });

const publishCommand = new Command("publish")
  .description("Put an installed bundle's pack and Studios on the shelf")
  .argument("<directory>", "The bundle directory holding pack.yaml")
  .action(async (directory: string) => {
    const bundle = readOrExit(directory);
    const draft = bundle.studios.filter((studio) => studio.status !== "PUBLISHED");
    if (draft.length > 0) {
      // Publishing is a property of the manifest, not a separate lifecycle the CLI can force.
      // A bundle whose Studios say DRAFT installs as DRAFT; making `publish` flip them would
      // mean the shipped artefact and the installed rows disagree about what was published.
      Logger.error(
        `${bundle.key} declares ${draft.length} Studio(s) as DRAFT: ${draft
          .map((studio) => studio.key)
          .join(", ")}`,
      );
      console.log(
        chalk.dim(
          "  Publication is declared in pack.yaml. Set status: PUBLISHED there and re-install,\n" +
            "  so the bundle on disk and the rows in the catalogue never disagree.",
        ),
      );
      process.exit(1);
    }
    requireAuth();
    const spinner = await createSpinner();
    spinner.start(`Publishing ${bundle.key} v${bundle.version}...`);
    try {
      const result = await PackApi.install(bundle);
      spinner.stop(
        `${chalk.bold(result.packKey)} v${result.version} is published — ${result.studiosInstalled} Studio(s) on the shelf.`,
      );
    } catch (error) {
      spinner.stop("Publish failed");
      fail("The bundle was not published", error);
    }
  });

const listCommand = new Command("list")
  .description("List the bundles this deployment's pack sources offer")
  .argument("[directory]", "Look in this directory instead of the configured sources")
  .action((directory?: string) => {
    // No hardcoded default any more: where packs come from is `orazaka.packs.sources`, the one
    // line that separates an OSS deployment from a cloud one (ADR-049). An explicit directory
    // still wins, because installing a bundle you are holding must not require configuration.
    const bundles = directory
      ? fs.existsSync(directory)
        ? fs
            .readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .filter((entry) => fs.existsSync(path.join(directory, entry.name, "pack.yaml")))
            .map((entry) => ({ directory: path.join(directory, entry.name), source: directory }))
        : []
      : discoverBundles();

    if (!directory) {
      for (const source of packSources()) {
        const mark = source.unavailable ? chalk.yellow("⚠") : chalk.dim("•");
        const note = source.unavailable ? chalk.dim(` — ${source.unavailable}`) : "";
        console.log(`  ${mark} ${source.kind} ${source.location}${note}`);
      }
    }

    if (bundles.length === 0) {
      Logger.info("No bundles found (a bundle is a directory holding pack.yaml).");
      return;
    }
    Logger.success(`${bundles.length} bundle(s)`);
    for (const found of bundles) {
      try {
        const { bundle, problems } = loadBundle(found.directory);
        if (problems.length > 0) {
          console.log(`  ${chalk.red("✗")} ${found.directory} ${chalk.dim("(manifest invalid)")}`);
          continue;
        }
        summarise(bundle);
      } catch {
        console.log(`  ${chalk.red("✗")} ${found.directory} ${chalk.dim("(unreadable)")}`);
      }
    }
  });

export const packCommand = new Command("pack")
  .description("Validate, install and publish pack bundles")
  .addCommand(listCommand)
  .addCommand(validateCommand)
  .addCommand(installCommand)
  .addCommand(publishCommand);
