/**
 * @file tool-path.ts
 * @description The absolute path of a program the CLI spawns (SonarCloud S4036: a program found through PATH can be
 * replaced by whoever controls PATH). Only the system and package-manager folders below are searched, never PATH.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const TRUSTED_TOOL_FOLDERS: readonly string[] = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

/** The first executable named `name` in the trusted folders; throws when there is none. */
export function toolPath(name: string, search: readonly string[] = TRUSTED_TOOL_FOLDERS): string {
  if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error(`${name} is not a program name`);
  for (const dir of search) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not in this folder
    }
  }
  throw new Error(`${name} not found in ${search.join(", ")}: install it and retry`);
}
