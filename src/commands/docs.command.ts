/**
 * @file docs.command.ts
 * @description `orazaka docs [build|sync]` (AGENTS.md §10) — code-driven documentation.
 * `build` regenerates docs/_generated/ from the code (with `--check` for the build gate);
 * `sync` copies the docs into the Krizaka site content tree.
 */

import { Command } from "commander";
import * as path from "node:path";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { intro, outro, note, logWarning, logSuccess } from "../ui/prompts";
import { resolveWorkspaceFrom } from "../utils/platform";

/** Orazaka workspace root (where the generator + docs/ live). */
function resolveMonorepoRoot(): string {
  return resolveWorkspaceFrom(__dirname);
}

/** Krizaka site root (products/<workspace> → products → krizaka-com). */
function resolveKrizakaRoot(root: string): string {
  return path.resolve(root, "..", "..");
}

function runGenerator(root: string, check: boolean): number {
  const node = process.execPath;
  const result = spawnSync(node, ["scripts/generate-docs.mjs", ...(check ? ["--check"] : [])], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  return result.status ?? 1;
}

const buildCommand = new Command("build")
  .description("Regenerate docs/_generated/ from the code")
  .option("--check", "Fail if any generated doc is stale (build gate), without writing")
  .action((opts: { check?: boolean }) => {
    const root = resolveMonorepoRoot();
    intro(chalk.cyan(`orazaka docs build${opts.check ? " --check" : ""}`));
    const code = runGenerator(root, Boolean(opts.check));
    if (code === 0) {
      outro(chalk.green(opts.check ? "✔ docs up to date" : "✔ docs generated"));
      return;
    }
    logWarning("docs build failed — generated docs are stale or the generator errored.");
    process.exitCode = code;
  });

const syncCommand = new Command("sync")
  .description("Copy docs/ (+ generated) into the Krizaka site content tree")
  .action(() => {
    const root = resolveMonorepoRoot();
    const krizaka = resolveKrizakaRoot(root);

    intro(chalk.cyan("orazaka docs sync"));

    // Always regenerate first so the synced docs reflect the current code.
    if (runGenerator(root, false) !== 0) {
      logWarning("generator failed — aborting sync.");
      process.exitCode = 1;
      return;
    }

    const docsSrc = path.join(root, "docs");
    const genSrc = path.join(docsSrc, "_generated");
    const contentDest = path.join(krizaka, "orazaka-content", "docs");

    // Mirror: wipe the destination so deleted/renamed docs never linger, then
    // re-publish. The site reads a FLAT slug namespace, so curated docs/*.md and
    // generated _generated/*.md are flattened into one level (architecture.json
    // is data, routed separately to app/data/).
    fs.rmSync(contentDest, { recursive: true, force: true });
    fs.mkdirSync(contentDest, { recursive: true });

    let published = 0;
    const copyMarkdown = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".md")) {
          fs.copyFileSync(path.join(dir, name), path.join(contentDest, name));
          published++;
        }
      }
    };
    copyMarkdown(docsSrc); // curated (top level)
    copyMarkdown(genSrc); // generated (flattened)
    // ADR source records keep their folder.
    const adrSrc = path.join(docsSrc, "adr");
    if (fs.existsSync(adrSrc)) fs.cpSync(adrSrc, path.join(contentDest, "adr"), { recursive: true });

    // The 3D architecture scene reads architecture.json from the site's data dir.
    const archSrc = path.join(genSrc, "architecture.json");
    const archDest = path.join(krizaka, "app", "data", "architecture.json");
    if (fs.existsSync(archSrc) && fs.existsSync(path.dirname(archDest))) {
      fs.copyFileSync(archSrc, archDest);
    }

    logSuccess(`Published ${published} docs → ${path.relative(krizaka, contentDest)}`);
    note(`architecture.json → ${path.relative(krizaka, archDest)}`, "Site data");
    outro(chalk.green("✔ docs synced"));
  });

export const docsCommand = new Command("docs")
  .description("Code-driven documentation: build (generate) | sync (to the site)")
  .addCommand(buildCommand)
  .addCommand(syncCommand);
