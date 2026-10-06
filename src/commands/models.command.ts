/**
 * @file models.command.ts
 * @description Scans the host hardware and reports which catalog models it can run.
 * Mirrors the backend `HostCapability` rule so the CLI report and the UI greying agree:
 * a model's `supported_hardware` must be blank/cpu/any, or match a host accelerator.
 */

import { Command } from "commander";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { intro, outro, logInfo, logWarning } from "../ui/prompts";
import { isAppleSilicon } from "../utils/platform";
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
