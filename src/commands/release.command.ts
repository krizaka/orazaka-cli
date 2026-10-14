/**
 * @file release.command.ts
 * @description `orazaka release verify` — checks a release manifest (one version for the whole Orazaka
 * bundle, docs/DELIVERY.md in krizaka/orazaka) and, with `--dir`, the artefacts of an offline bundle
 * against it. Exit code 1 on any problem, so a release pipeline or an installer can gate on it.
 */

import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { intro, outro, logError, logSuccess, logInfo } from "../ui/prompts";
import {
  RELEASE_TARGETS,
  readReleaseManifest,
  validateReleaseManifest,
  verifyArtefacts,
  type ReleaseManifest,
  type ReleaseTarget,
} from "../services/release-manifest";

interface VerifyOptions {
  dir?: string;
  target?: string;
  json?: boolean;
}

function verify(file: string, options: VerifyOptions): { manifest?: ReleaseManifest; problems: string[] } {
  if (options.target && !(RELEASE_TARGETS as readonly string[]).includes(options.target)) {
    return { problems: [`unknown target '${options.target}' (one of ${RELEASE_TARGETS.join(", ")})`] };
  }
  const read = readReleaseManifest(path.resolve(file));
  if (read.problems.length > 0) return { problems: read.problems };
  const problems = validateReleaseManifest(read.manifest);
  if (problems.length > 0) return { problems };
  const manifest = read.manifest as ReleaseManifest;
  const artefactProblems = options.dir
    ? verifyArtefacts(manifest, path.resolve(options.dir), options.target as ReleaseTarget | undefined)
    : [];
  return { manifest, problems: artefactProblems };
}

const verifyCommand = new Command("verify")
  .description("Check a release manifest, and with --dir the artefacts of an offline bundle against it")
  .argument("<manifest>", "Path to the release manifest (orazaka-release.json)")
  .option("--dir <path>", "Offline bundle directory whose artefacts are checked (size and SHA-256)")
  .option("--target <target>", "Only the artefacts of one target: mac-arm64, linux-amd64 or linux-arm64")
  .option("--json", "Print the result as JSON")
  .action(async (file: string, options: VerifyOptions) => {
    const { manifest, problems } = verify(file, options);
    if (options.json) {
      console.log(JSON.stringify({ version: manifest?.version ?? null, ok: problems.length === 0, problems }, null, 2));
      if (problems.length > 0) process.exitCode = 1;
      return;
    }
    await intro(chalk.cyan.bold("🥷 Orazaka release"));
    if (problems.length > 0) {
      for (const problem of problems) await logError(problem);
      await outro(chalk.red(`${String(problems.length)} problem(s): this release cannot be installed.`));
      process.exitCode = 1;
      return;
    }
    if (manifest) {
      await logInfo(
        `Orazaka ${manifest.version} (${manifest.channel}) · ${manifest.targets.join(", ")} · ` +
          `${String(manifest.images.length)} image(s), ${String(manifest.artefacts.length)} artefact(s), ` +
          `${String(manifest.models.length)} model(s), ${String(manifest.packs.length)} pack(s)`,
      );
    }
    await logSuccess(options.dir ? "Manifest valid; every artefact matches it." : "Manifest valid.");
    await outro(chalk.cyan("Ready to install."));
  });

export const releaseCommand = new Command("release")
  .description("Release bundles — check a release manifest and an offline bundle before installing it")
  .addCommand(verifyCommand);
