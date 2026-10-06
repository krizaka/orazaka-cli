/**
 * @file pid.ts
 * @description PID-file helpers shared by the lifecycle commands. The CLI tracks
 * detached native processes (Ollama, workers, Router JAR…) in a single
 * `var/.orazaka.pid` file written as `name=pid` lines; this module is the one
 * place that reads, writes and liveness-checks those entries.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Parses a `name=pid` PID file into a map. Missing/invalid lines are skipped. */
export function readPidFile(pidFile: string): Map<string, number> {
  const pids = new Map<string, number>();
  if (!fs.existsSync(pidFile)) return pids;

  for (const line of fs.readFileSync(pidFile, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    const pid = parseInt(trimmed.slice(eq + 1).trim(), 10);
    if (name && !Number.isNaN(pid)) pids.set(name, pid);
  }
  return pids;
}

/** Appends a `name=pid` entry to the PID file, creating the parent dir if needed. */
export function appendPid(pidFile: string, name: string, pid: number | undefined): void {
  if (pid === undefined) return;
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.appendFileSync(pidFile, `${name}=${String(pid)}\n`, "utf-8");
}

/** Checks whether a process with the given PID is currently alive. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
