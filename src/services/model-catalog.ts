/**
 * @file model-catalog.ts
 * @description Reads and updates the model catalogue (`orazaka_models`) of the local database.
 *
 * The catalogue is data in the DB (AGENTS.md §4): which image model is the default is a row, not a
 * flag of this CLI. These helpers go through `psql` inside the database container, like every
 * local-only command of this CLI, and take only values they have already validated.
 */

import { execFileSync } from "node:child_process";

const CONTAINER = "orazaka-db-vector";

/** Runs one statement against the jobs database and returns its rows, split on `|`. */
export function queryCatalog(sql: string, env: NodeJS.ProcessEnv = process.env): string[][] {
  const out = execFileSync(
    "docker",
    [
      "exec", "-i", CONTAINER, "psql",
      "-U", env.DB_USERNAME ?? "orazaka_app",
      "-d", env.DB_NAME ?? "orazaka_db",
      "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F|", "-c", sql,
    ],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|"));
}

/** A model name the catalogue may hold: letters, digits, dots, dashes, slashes, colons. */
const MODEL_NAME = /^[A-Za-z0-9._:/-]{1,255}$/;

function requireModelName(name: string): string {
  if (!MODEL_NAME.test(name)) {
    throw new Error(`Not a catalogue model name: ${name}`);
  }
  return name;
}

/** @returns the catalogue's default image model, or `undefined` when it names none. */
export function defaultImageModel(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const rows = queryCatalog(
    "SELECT model_name FROM orazaka_models WHERE category = 'image' AND is_default ORDER BY model_name LIMIT 1",
    env,
  );
  return rows[0]?.[0];
}

/**
 * Makes `name` the one default image model.
 *
 * @throws when the catalogue has no image row of that name — the row comes from the job service's
 *     seed (or its migration), never from this command
 */
export function setDefaultImageModel(name: string, env: NodeJS.ProcessEnv = process.env): void {
  const model = requireModelName(name);
  const rows = queryCatalog(
    `UPDATE orazaka_models SET is_default = (model_name = '${model}') WHERE category = 'image' ` +
      `AND EXISTS (SELECT 1 FROM orazaka_models WHERE category = 'image' AND model_name = '${model}') ` +
      "RETURNING model_name",
    env,
  );
  if (rows.length === 0) {
    throw new Error(
      `The catalogue has no image model '${model}'. Apply infra/migrations/2026-10-11-image-models.sql ` +
        "from the workspace (or reset the database), then retry.",
    );
  }
}
