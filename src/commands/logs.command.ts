/**
 * @file logs.command.ts
 * @description Real-time log streaming and historical log viewing.
 * Supports multiplexed tailing, per-service filtering, and log listing.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { intro, outro, logWarning, logInfo, note } from "../ui/prompts";
import { resolveLogDir, resolveWorkspaceRoot } from "../ui/platform";
import {
  appendedLines,
  filterByService,
  formatAge,
  formatFileSize,
  getServiceColor,
  getServiceLabel,
  lastLines,
  parseSinceMs,
  readRange,
} from "./logs.steps";

type LogsOptions = { service?: string; list?: boolean; since?: string; tail?: string };

/** At most this many files are tailed, to avoid flooding the terminal. */
const MAX_TAILED_FILES = 5;

const TITLE = chalk.cyan.bold("🥷 Orazaka Logs");

/** Nothing to show: a title, a warning (and an optional hint), a closing line. */
async function bail(warning: string, closing: string, hint?: string): Promise<void> {
  await intro(TITLE);
  await logWarning(warning);
  if (hint) await logInfo(hint);
  await outro(closing);
}

/** The `.log` files of a directory, most recent name first. */
function listLogFiles(logDir: string): string[] {
  return fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith(".log"))
    .sort()
    .reverse();
}

function describeLogFile(logDir: string, file: string): { line: string; size: number } {
  const stats = fs.statSync(path.join(logDir, file));
  const colorFn = getServiceColor(file);
  const label = getServiceLabel(file);
  const ageStr = formatAge(stats.mtimeMs, Date.now());
  const line = `${colorFn(`[${label}]`)} ${chalk.white(file.padEnd(45))} ${chalk.gray(formatFileSize(stats.size).padStart(10))} ${chalk.gray(ageStr)}`;
  return { line, size: stats.size };
}

async function showListing(logDir: string, allFiles: string[]): Promise<void> {
  await intro(chalk.cyan.bold("🥷 Orazaka Logs — File Listing"));

  const described = allFiles.map((file) => describeLogFile(logDir, file));
  const totalSize = described.reduce((sum, { size }) => sum + size, 0);
  const lines = [
    ...described.map(({ line }) => line),
    "",
    `${chalk.gray("Total:")} ${String(allFiles.length)} file(s), ${formatFileSize(totalSize)}`,
  ];

  await note(lines.join("\n"), "Available Log Files");
  await outro(`Tail logs: ${chalk.cyan("npx orazaka logs")} or ${chalk.cyan("npx orazaka logs --service router")}`);
}

/** The files modified within the last `sinceMs`. */
function filterBySince(logDir: string, files: string[], sinceMs: number): string[] {
  const cutoff = Date.now() - sinceMs;
  return files.filter((f) => fs.statSync(path.join(logDir, f)).mtimeMs >= cutoff);
}

function printHeader(fileCount: number): void {
  console.log("");
  console.log(chalk.cyan.bold("🥷 Orazaka Logs — Real-time Stream"));
  console.log(chalk.gray(`  Tailing ${String(fileCount)} file(s) | Ctrl+C to stop`));
  console.log(chalk.gray("  ─".repeat(30)));
  console.log("");
}

/** Shows the last lines of one file under a rule; unreadable files are skipped. */
function printRecentLines(logDir: string, file: string, tailLines: number): void {
  const colorFn = getServiceColor(file);
  const label = getServiceLabel(file);

  try {
    const lines = lastLines(fs.readFileSync(path.join(logDir, file), "utf-8"), tailLines);
    if (lines.length === 0) return;
    console.log(colorFn(`── ${label} (${file}) ${"─".repeat(Math.max(0, 50 - file.length))}`));
    for (const line of lines) {
      console.log(`${colorFn(`[${label}]`)} ${line}`);
    }
    console.log("");
  } catch {
    /* skip unreadable files */
  }
}

/** Prints what was appended to a file since the last position and moves the position on. */
function printAppended(filePath: string, positions: Map<string, number>, print: (line: string) => void): void {
  try {
    const size = fs.statSync(filePath).size;
    const previous = positions.get(filePath) ?? 0;
    if (size <= previous) return;

    for (const line of appendedLines(readRange(filePath, previous, size))) {
      print(line);
    }
    positions.set(filePath, size);
  } catch {
    /* ignore read errors during watch */
  }
}

/** Watches one file for appended lines; undefined when it cannot be watched. */
function watchLogFile(logDir: string, file: string, positions: Map<string, number>): fs.FSWatcher | undefined {
  const filePath = path.join(logDir, file);
  const colorFn = getServiceColor(file);
  const label = getServiceLabel(file);

  try {
    positions.set(filePath, fs.statSync(filePath).size);
    return fs.watch(filePath, (eventType) => {
      if (eventType !== "change") return;
      printAppended(filePath, positions, (line) => console.log(`${colorFn(`[${label}]`)} ${line}`));
    });
  } catch {
    /* skip files that can't be watched */
    return undefined;
  }
}

/** Keeps the process alive until Ctrl+C, then closes the watchers. */
function waitForInterrupt(watchers: fs.FSWatcher[]): Promise<void> {
  return new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      for (const watcher of watchers) {
        watcher.close();
      }
      console.log("\n" + chalk.gray("Log streaming stopped."));
      resolve();
    });
  });
}

async function streamLogs(logDir: string, files: string[], tailLines: number): Promise<void> {
  printHeader(files.length);

  const tailed = files.slice(0, MAX_TAILED_FILES);
  for (const file of tailed) {
    printRecentLines(logDir, file, tailLines);
  }

  console.log(chalk.gray("  ═══ Watching for new log entries... ═══"));
  console.log("");

  const positions = new Map<string, number>();
  const watchers = tailed
    .map((file) => watchLogFile(logDir, file, positions))
    .filter((watcher): watcher is fs.FSWatcher => watcher !== undefined);

  await waitForInterrupt(watchers);
}

export const logsCommand = new Command("logs")
  .description("Stream and browse service logs")
  .option("--service <name>", "Tail a specific service (router, ollama, media-worker, image-worker, ui)")
  .option("--list", "List all available log files with sizes")
  .option("--since <duration>", "Show logs from last N hours (e.g., 1h, 30m)", "24h")
  .option("--tail <lines>", "Number of lines to show from end of file", "50")
  .action(async (options: LogsOptions) => {
    const logDir = resolveLogDir();

    if (!fs.existsSync(logDir)) {
      const relative = path.relative(resolveWorkspaceRoot(), logDir);
      await bail(
        `Log directory not found: ${chalk.gray(relative)}\n` +
          `  Run ${chalk.cyan("npx orazaka start")} first to generate logs.`,
        "No logs available.",
      );
      return;
    }

    const allFiles = listLogFiles(logDir); // Most recent first
    if (allFiles.length === 0) {
      await bail("No log files found.", "No logs available.");
      return;
    }

    if (options.list) {
      await showListing(logDir, allFiles);
      return;
    }

    const byService = filterByService(allFiles, options.service);
    if (byService.length === 0) {
      await bail(
        `No logs found for service: ${chalk.yellow(options.service)}`,
        "Try a different service name.",
        `Available services: ${chalk.gray("router, ollama, media-worker, image-worker, ui")}`,
      );
      return;
    }

    const targetFiles = filterBySince(logDir, byService, parseSinceMs(options.since));
    if (targetFiles.length === 0) {
      await bail(`No logs found within the last ${options.since ?? "24h"}`, "Try a longer duration with --since.");
      return;
    }

    await streamLogs(logDir, targetFiles, parseInt(options.tail ?? "50"));
  });
