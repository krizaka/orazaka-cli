/**
 * @file db.command.ts
 * @description Database maintenance commands. `infra/initdb/` is the seed source
 * (one file per bounded context / future service owner, applied in alphabetical
 * order) and is fully replayable — `00-reset.sql` begins by
 * `DROP TABLE IF EXISTS … CASCADE` for every table. It only runs automatically on
 * a *fresh* Postgres volume, so after editing a seed (e.g. adding `${prompt}` to
 * a capability payload template) a running stack keeps the stale rows.
 * `orazaka db reseed` re-applies the whole directory on demand.
 */

import { Command } from "commander";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { confirm, createSpinner, intro, isCancel, logError, logInfo, logWarning, outro } from "../ui/prompts";
import { strEnv } from "../utils/config";
import { resolveWorkspaceRootSmart } from "../utils/platform";

/** Compose `container_name` of the pgvector Postgres service (infra/docker-compose.yml). */
const DB_CONTAINER = "orazaka-db-vector";

/** Reads infra/initdb/*.sql concatenated in execution (alphabetical) order. */
function readInitDb(root: string): { files: string[]; sql: string } | null {
  const dir = path.join(root, "infra", "initdb");
  if (!fs.existsSync(dir)) {
    return null;
  }
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    return null;
  }
  const sql = files.map((n) => fs.readFileSync(path.join(dir, n), "utf8")).join("\n");
  return { files, sql };
}

/** Re-applies infra/initdb/*.sql inside the running Postgres container via psql. */
async function reseed(opts: { yes?: boolean }): Promise<void> {
  const root = resolveWorkspaceRootSmart();
  const dbName = strEnv("DB_NAME", "orazaka_db");
  const dbUser = strEnv("DB_USERNAME", "orazaka_app");

  await intro(chalk.cyan("Orazaka DB Reseed"));

  const initDb = readInitDb(root);
  if (!initDb) {
    await logError(`Seed directory not found or empty: ${path.join(root, "infra", "initdb")}`);
    process.exit(1);
  }

  await logWarning(
    "This DROPs every table and replays infra/initdb/*.sql — all local data (users, chats, jobs) is wiped.",
  );

  if (!opts.yes) {
    const ok = await confirm({ message: `Reseed database "${dbName}" now?`, initialValue: false });
    if (isCancel(ok) || !ok) {
      await outro(chalk.red("Cancelled."));
      return;
    }
  }

  const s = await createSpinner();
  s.start(`Applying ${initDb.files.length} initdb files…`);

  const res = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", dbUser, "-d", dbName, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
    { input: initDb.sql },
  );

  if (res.status !== 0) {
    s.stop("Reseed failed");
    const detail = (res.stderr?.toString() || res.error?.message || "unknown error").trim();
    await logError(detail.split("\n").slice(-5).join("\n"));
    await logInfo(`Is the database container running? Start it with: orazaka start --mode dev`);
    process.exit(1);
  }

  s.stop("Database reseeded");
  await outro(
    chalk.green("✓ Schema + seed re-applied. Reload the playground — the prompt fields will appear."),
  );
}

export const dbCommand = new Command("db").description("Database maintenance operations");

dbCommand
  .command("reseed")
  .description("Drop & re-apply infra/initdb/*.sql (schema + seed). Destroys all local dev data.")
  .option("-y, --yes", "Skip the destructive-action confirmation prompt")
  .action(reseed);
