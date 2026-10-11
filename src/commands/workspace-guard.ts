/**
 * @file workspace-guard.ts
 * @description The commands that drive the platform (start, dev, test, docs) run inside an Orazaka
 * workspace. Installed from npm, the CLI can be started anywhere: outside a workspace it says what is
 * missing and how to get it, instead of spawning `./mvnw` in an empty directory.
 */

import * as path from "node:path";
import chalk from "chalk";
import { locateWorkspace } from "../utils/platform";

/** What a newcomer needs, in the order the workspace loop uses it (AGENTS.md §1). */
const WORKSPACE_HELP = [
  "Requirements: git, JDK 21, Node.js 22+, Docker (Python 3.11+ for the media worker).",
  "",
  `  ${chalk.cyan("npx orazaka install")}            clones the platform into ./orazaka, then configures it`,
  "  or by hand:",
  `  ${chalk.cyan("git clone https://github.com/krizaka/orazaka.git && cd orazaka")}`,
  `  ${chalk.cyan("node scripts/workspace.mjs clone")}`,
  `  ${chalk.cyan("./mvnw install")} ${chalk.gray("&&")} ${chalk.cyan("(cd orazaka-apps/ui && npm install)")}`,
].join("\n");

/**
 * The workspace root, or exits with the way to get one. Run from outside the workspace it was found in
 * (a clone's own CLI started elsewhere), the process moves into it so every path resolves the same way.
 */
export function requireWorkspace(command: string): string {
  const root = locateWorkspace();
  if (root) {
    if (path.relative(root, process.cwd()).startsWith("..")) process.chdir(root);
    return root;
  }
  console.error(
    chalk.red(`✖ \`orazaka ${command}\` runs inside an Orazaka workspace, and none was found above ${process.cwd()}.`),
  );
  console.error(`\n${WORKSPACE_HELP}\n`);
  process.exit(1);
}
