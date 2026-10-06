/**
 * @file process.ts
 * @description Child-process spawning helpers shared by the lifecycle commands.
 * Two patterns lived duplicated across `dev` and `start`: (1) spawning a
 * foreground process with color-prefixed, de-noised output, and (2) spawning a
 * detached native daemon whose output is appended to a log file and whose PID is
 * tracked. Both now live here, exactly once.
 */

import * as fs from "node:fs";
import { spawn, ChildProcess } from "node:child_process";
import chalk from "chalk";
import { appendPid } from "./pid";

/** Lines matching these patterns are filtered from prefixed process output. */
const NOISE_PATTERNS: RegExp[] = [
  /^> [\w@./-]+ \w+$/, // > package@1.0.0 script
  /^> .+$/, // > next dev --port 3000
  /^\s*$/, // blank lines
];

/** True if a log line is noise that should be suppressed from prefixed output. */
export function isNoiseLine(line: string): boolean {
  const stripped = line
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, "")
    .trim();
  return NOISE_PATTERNS.some((p) => p.test(stripped));
}

/** Foreground process whose stdout/stderr is piped with a colored label prefix. */
export interface PrefixedProcess {
  readonly label: string;
  readonly color: (text: string) => string;
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
}

/**
 * Spawns a child with prefixed, color-coded stdout/stderr piping.
 * Uses shell:false to avoid DEP0190 deprecation warnings.
 */
export function spawnWithPrefix(config: PrefixedProcess): ChildProcess {
  const prefix = config.color(`  ${config.label.padEnd(12)}`);

  const child = spawn(config.command, config.args, {
    cwd: config.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  const pipe = (data: Buffer, dim: boolean) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      if (!isNoiseLine(line)) {
        console.log(`${prefix} ${chalk.white("│")} ${dim ? chalk.dim(line) : line}`);
      }
    }
  };

  child.stdout?.on("data", (d: Buffer) => pipe(d, false));
  child.stderr?.on("data", (d: Buffer) => pipe(d, true));

  child.on("error", (err) => {
    console.log(`${prefix} ${chalk.red("│")} ${chalk.red("✗")} Failed to start: ${chalk.dim(err.message)}`);
  });

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.log(`${prefix} ${chalk.red("│")} ${chalk.red("✗")} Exited with code ${String(code)}`);
    } else {
      console.log(`${prefix} ${chalk.dim("│")} ${chalk.dim("○ Stopped")}`);
    }
  });

  return child;
}

/** Options for {@link spawnDetachedToLog}. */
export interface DetachedSpawnOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logFile: string;
  readonly pidFile?: string;
  readonly pidName?: string;
}

/**
 * Spawns a detached background daemon, appending its output to `logFile` and
 * (optionally) recording its PID. Returns the child so callers can read `.pid`.
 */
export function spawnDetachedToLog(command: string, args: string[], opts: DetachedSpawnOptions): ChildProcess {
  // Open a REAL file descriptor (fs.createWriteStream opens its fd asynchronously,
  // so passing the stream straight to spawn throws "stdio is invalid: fd null").
  // The child inherits a dup of the fd, so we can close our copy right after spawn.
  const fd = fs.openSync(opts.logFile, "a");
  try {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      detached: true,
      env: opts.env ?? process.env,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    if (opts.pidFile && opts.pidName) appendPid(opts.pidFile, opts.pidName, child.pid);
    return child;
  } finally {
    fs.closeSync(fd);
  }
}
