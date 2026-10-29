/**
 * @file workspace-bootstrap.ts
 * @description Turns an empty directory into an Orazaka workspace: clones the workspace repository
 * (krizaka/orazaka), then every component repository at its path through the workspace's own tool
 * (`node scripts/workspace.mjs clone`). This is what makes `npx orazaka install` work on a machine that
 * has nothing yet — the CLI on npm carries no copy of the platform, it fetches the real one.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { WORKSPACE_MANIFEST } from "../utils/platform";

/** The workspace repository every component is assembled from. */
export const WORKSPACE_REPOSITORY = "https://github.com/krizaka/orazaka.git";

/** Runs a command; injectable so the sequence is testable without git or a network. */
export type Runner = (
  cmd: string,
  args: readonly string[],
  cwd: string,
) => Pick<SpawnSyncReturns<Buffer>, "status" | "error">;

const inherit: Runner = (cmd, args, cwd) =>
  spawnSync(cmd, [...args], { cwd, stdio: "inherit", shell: process.platform === "win32" });

export interface BootstrapResult {
  readonly ok: boolean;
  readonly root: string;
  readonly error?: string;
}

/**
 * Clones the workspace into {@code target} (shallow by default) and every repository it lists.
 * A directory that already holds a workspace is reused — only the missing repositories are cloned.
 */
export function bootstrapWorkspace(
  target: string,
  opts: { depth?: number; repository?: string; run?: Runner } = {},
): BootstrapResult {
  const root = path.resolve(target);
  const run = opts.run ?? inherit;
  const depth = opts.depth && opts.depth > 0 ? ["--depth", String(opts.depth)] : [];

  if (!fs.existsSync(path.join(root, WORKSPACE_MANIFEST))) {
    if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
      return { ok: false, root, error: `${root} exists and is not empty — choose another directory (--dir).` };
    }
    const clone = run("git", ["clone", ...depth, opts.repository ?? WORKSPACE_REPOSITORY, root], path.dirname(root));
    if (clone.status !== 0) {
      return { ok: false, root, error: `git clone failed${clone.error ? `: ${clone.error.message}` : ""}.` };
    }
  }

  const components = run(process.execPath, [path.join("scripts", "workspace.mjs"), "clone", ...depth], root);
  if (components.status !== 0) {
    return { ok: false, root, error: "node scripts/workspace.mjs clone failed — re-run it from the workspace." };
  }
  return { ok: true, root };
}
