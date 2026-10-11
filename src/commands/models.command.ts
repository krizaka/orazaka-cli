/**
 * @file models.command.ts
 * @description Scans the host hardware and reports which catalog models it can run.
 * Mirrors the backend `HostCapability` rule so the CLI report and the UI greying agree:
 * a model's `supported_hardware` must be blank/cpu/any, or match a host accelerator.
 *
 * `orazaka models image list|pull|use` installs the local image models (stable-diffusion.cpp
 * recipes, services/image-model-recipes.json) and chooses which one the catalogue serves.
 */

import { Command } from "commander";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { intro, outro, logInfo, logWarning, logSuccess, logError } from "../ui/prompts";
import { isAppleSilicon, resolveModelsDir } from "../utils/platform";
import {
  IMAGE_MODELS,
  downloadBytes,
  findImageModel,
  isInstalled,
  pullImageModel,
} from "../services/image-models";
import { defaultImageModel, setDefaultImageModel } from "../services/model-catalog";
import "../utils/config"; // side-effect: loads .env into process.env (DB_NAME/DB_USERNAME)

/** Accelerators exposed by the host — mirrors core `HostCapabilityDetector`. */
function hostAccelerators(): string[] {
  return isAppleSilicon() ? ["APPLE_SILICON_MLX", "mps", "coreml"] : ["cpu"];
}

/** Mirrors `HostCapability.supportsModelHardware`. */
function isCompatible(supportedHardware: string, host: string[]): boolean {
  const hw = (supportedHardware ?? "").trim().toLowerCase();
  if (!hw || hw === "cpu" || hw === "any" || hw === "universal") return true;
  return host.some((accelerator) => accelerator.toLowerCase() === hw);
}

export const modelsCommand = new Command("models")
  .description("Scan the host hardware and report which catalog models it can run")
  .action(async () => {
    await intro(chalk.cyan.bold("🥷 Orazaka Model Compatibility"));

    const host = hostAccelerators();
    await logInfo(`Host accelerators: ${chalk.white(host.join(", "))}`);

    const dbName = process.env.DB_NAME ?? "orazaka_db";
    const dbUser = process.env.DB_USERNAME ?? "orazaka_app";
    const sql =
      "SELECT category, model_name, COALESCE(supported_hardware,'') " +
      "FROM orazaka_models ORDER BY category, model_name";

    let rows: string[][];
    try {
      const out = execSync(
        `docker exec -i orazaka-db-vector psql -U ${dbUser} -d ${dbName} -t -A -F'|' -c "${sql}"`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
      );
      rows = out
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split("|"));
    } catch {
      await logWarning(
        "Could not read orazaka_models — is the database up? Run `npm run infra`.",
      );
      await outro(chalk.red("Compatibility scan aborted."));
      return;
    }

    let incompatible = 0;
    for (const [category, model, hardware] of rows) {
      const ok = isCompatible(hardware, host);
      if (!ok) incompatible++;
      const tag = ok ? chalk.green("● run ") : chalk.red("○ skip");
      const requirement = hardware ? chalk.gray(`needs ${hardware}`) : chalk.gray("universal");
      console.log(`  ${tag} ${chalk.dim(category.padEnd(6))} ${model.padEnd(46)} ${requirement}`);
    }

    const summary =
      incompatible === 0
        ? chalk.green(`All ${String(rows.length)} models run on this host.`)
        : chalk.yellow(
            `${String(incompatible)}/${String(rows.length)} model(s) need hardware this host lacks ` +
              `(greyed out in the UI model picker).`,
          );
    await outro(summary);
  });

const gb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;

function catalogueDefault(): string | undefined {
  try {
    return defaultImageModel();
  } catch {
    return undefined;
  }
}

const imageCommand = new Command("image").description(
  "Local image models (stable-diffusion.cpp, Metal): list, download, choose the one served",
);

imageCommand
  .command("list")
  .description("List the installable image models, their licence, size and whether they are installed")
  .action(async () => {
    await intro(chalk.cyan.bold("🥷 Orazaka image models"));
    const modelsDir = resolveModelsDir();
    const current = catalogueDefault();
    for (const recipe of IMAGE_MODELS) {
      const installed = isInstalled(recipe, modelsDir);
      const tag = installed ? chalk.green("● installed") : chalk.gray("○ not pulled");
      const star = recipe.id === current ? chalk.yellow(" ★ served") : "";
      console.log(`  ${tag} ${chalk.bold(recipe.id.padEnd(22))} ${recipe.label}${star}`);
      console.log(
        chalk.gray(
          `      ${recipe.licence} · ${gb(downloadBytes(recipe))} on disk · ~${String(recipe.ramGb)} GB RAM · ${recipe.measured}`,
        ),
      );
      console.log(chalk.gray(`      ${recipe.summary}`));
    }
    await outro(
      current
        ? `The catalogue serves ${chalk.bold(current)}. Change it with ${chalk.cyan("orazaka models image use <id>")}.`
        : "Database unreachable: the served model is unknown (npm run infra).",
    );
  });

imageCommand
  .command("pull")
  .argument("<id>", "Model id (see `orazaka models image list`)")
  .description("Download an image model into ~/models/stable-diffusion and verify its checksums")
  .action(async (id: string) => {
    const recipe = findImageModel(id);
    if (!recipe) {
      await logError(`Unknown image model '${id}'. Known: ${IMAGE_MODELS.map((m) => m.id).join(", ")}`);
      process.exit(1);
    }
    await intro(chalk.cyan(`Pulling ${recipe.label} (${recipe.licence}, ${gb(downloadBytes(recipe))})`));
    let lastShown = 0;
    try {
      const pulled = await pullImageModel(recipe, resolveModelsDir(), {
        fetch: (url) => fetch(url),
        onProgress: ({ file, received }) => {
          const now = Date.now();
          if (now - lastShown > 2000 || received === file.bytes) {
            lastShown = now;
            process.stdout.write(
              `\r  ${file.path}  ${String(Math.floor((received / file.bytes) * 100))}%   `,
            );
          }
        },
      });
      process.stdout.write("\n");
      await logSuccess(
        pulled.length === 0
          ? "✔ Already installed — nothing to download"
          : `✔ ${String(pulled.length)} file(s) downloaded and verified (sha256)`,
      );
      await outro(`Serve it with ${chalk.cyan(`orazaka models image use ${recipe.id}`)}, then restart the image server.`);
    } catch (err) {
      await logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

imageCommand
  .command("use")
  .argument("<id>", "Model id (see `orazaka models image list`)")
  .description("Make an installed image model the catalogue's default — the one `orazaka start` serves")
  .action(async (id: string) => {
    const recipe = findImageModel(id);
    if (!recipe) {
      await logError(`Unknown image model '${id}'.`);
      process.exit(1);
    }
    if (!isInstalled(recipe, resolveModelsDir())) {
      await logError(`${recipe.label} is not installed: run orazaka models image pull ${recipe.id}`);
      process.exit(1);
    }
    try {
      setDefaultImageModel(recipe.id);
    } catch (err) {
      await logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    await logSuccess(`✔ ${recipe.label} is the default image model`);
    await logWarning(
      "sd-server serves one model at a time: restart the stack (orazaka stop, then orazaka start) to load it.",
    );
  });

modelsCommand.addCommand(imageCommand);
