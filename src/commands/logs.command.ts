/**
 * @file logs.command.ts
 * @description Real-time log streaming and historical log viewing.
 * Supports multiplexed tailing, per-service filtering, and log listing.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import {
  intro,
  outro,
  logWarning,
  logInfo,
  note,
} from "../ui/prompts";
import { resolveLogDir, resolveWorkspaceRoot } from "../ui/platform";

/** Color map for service log prefixes. */
const SERVICE_COLORS: Record<string, (s: string) => string> = {
  router: chalk.cyan,
  gateway: chalk.cyan, // legacy log filename alias
  ollama: chalk.green,
  "media-worker": chalk.magenta,
  "video-worker": chalk.magenta, // legacy log filename alias
  "image-worker": chalk.yellow,
  ui: chalk.blue,
  docker: chalk.gray,
};

function getServiceColor(filename: string): (s: string) => string {
  for (const [key, colorFn] of Object.entries(SERVICE_COLORS)) {
    if (filename.toLowerCase().includes(key)) return colorFn;
  }
  return chalk.white;
}

function getServiceLabel(filename: string): string {
  if (filename.includes("router") || filename.includes("gateway")) return "ROUTER ";
  if (filename.includes("ollama")) return "OLLAMA ";
  if (filename.includes("media") || filename.includes("video")) return "MEDIA  ";
  if (filename.includes("image")) return "IMAGE  ";
  if (filename.includes("ui")) return "UI     ";
  return "LOG    ";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const logsCommand = new Command("logs")
  .description("Stream and browse service logs")
  .option("--service <name>", "Tail a specific service (router, ollama, media-worker, image-worker, ui)")
  .option("--list", "List all available log files with sizes")
  .option("--since <duration>", "Show logs from last N hours (e.g., 1h, 30m)", "24h")
  .option("--tail <lines>", "Number of lines to show from end of file", "50")
  .action(async (options: {
    service?: string;
    list?: boolean;
    since?: string;
    tail?: string;
  }) => {
    const logDir = resolveLogDir();
    const workspaceRoot = resolveWorkspaceRoot();

    if (!fs.existsSync(logDir)) {
      await intro(chalk.cyan.bold("🥷 Orazaka Logs"));
      await logWarning(
        `Log directory not found: ${chalk.gray(path.relative(workspaceRoot, logDir))}\n` +
        `  Run ${chalk.cyan("npx orazaka start")} first to generate logs.`
      );
      await outro("No logs available.");
      return;
    }

    const allFiles = fs.readdirSync(logDir)
      .filter((f) => f.endsWith(".log"))
      .sort()
      .reverse(); // Most recent first

    if (allFiles.length === 0) {
      await intro(chalk.cyan.bold("🥷 Orazaka Logs"));
      await logWarning("No log files found.");
      await outro("No logs available.");
      return;
    }

    // ─── List mode ──────────────────────────────────────────────
    if (options.list) {
      await intro(chalk.cyan.bold("🥷 Orazaka Logs — File Listing"));

      const lines: string[] = [];
      let totalSize = 0;

      for (const file of allFiles) {
        const filePath = path.join(logDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;

        const colorFn = getServiceColor(file);
        const label = getServiceLabel(file);
        const age = Math.round((Date.now() - stats.mtimeMs) / (1000 * 60));
        const ageStr = age < 60 ? `${String(age)}m ago` : `${Math.round(age / 60)}h ago`;

        lines.push(
          `${colorFn(`[${label}]`)} ${chalk.white(file.padEnd(45))} ${chalk.gray(formatFileSize(stats.size).padStart(10))} ${chalk.gray(ageStr)}`
        );
      }

      lines.push("");
      lines.push(`${chalk.gray("Total:")} ${String(allFiles.length)} file(s), ${formatFileSize(totalSize)}`);

      await note(lines.join("\n"), "Available Log Files");
      await outro(`Tail logs: ${chalk.cyan("npx orazaka logs")} or ${chalk.cyan("npx orazaka logs --service router")}`);
      return;
    }

    // ─── Filter by service ──────────────────────────────────────
    let targetFiles = allFiles;
    if (options.service) {
      targetFiles = allFiles.filter((f) =>
        f.toLowerCase().includes(options.service!.toLowerCase())
      );

      if (targetFiles.length === 0) {
        await intro(chalk.cyan.bold("🥷 Orazaka Logs"));
        await logWarning(`No logs found for service: ${chalk.yellow(options.service)}`);
        await logInfo(`Available services: ${chalk.gray("router, ollama, media-worker, image-worker, ui")}`);
        await outro("Try a different service name.");
        return;
      }
    }

    // ─── Parse since duration ───────────────────────────────────
    let sinceMs = 24 * 60 * 60 * 1000; // Default 24h
    if (options.since) {
      const match = options.since.match(/^(\d+)(h|m|d)$/);
      if (match) {
        const value = parseInt(match[1]!);
        const unit = match[2];
        if (unit === "h") sinceMs = value * 60 * 60 * 1000;
        else if (unit === "m") sinceMs = value * 60 * 1000;
        else if (unit === "d") sinceMs = value * 24 * 60 * 60 * 1000;
      }
    }

    // Filter files by modification time
    const cutoff = Date.now() - sinceMs;
    targetFiles = targetFiles.filter((f) => {
      const stats = fs.statSync(path.join(logDir, f));
      return stats.mtimeMs >= cutoff;
    });

    if (targetFiles.length === 0) {
      await intro(chalk.cyan.bold("🥷 Orazaka Logs"));
      await logWarning(`No logs found within the last ${options.since ?? "24h"}`);
      await outro("Try a longer duration with --since.");
      return;
    }

    // ─── Tail mode (real-time streaming) ────────────────────────
    const tailLines = parseInt(options.tail ?? "50");

    console.log("");
    console.log(chalk.cyan.bold("🥷 Orazaka Logs — Real-time Stream"));
    console.log(chalk.gray(`  Tailing ${String(targetFiles.length)} file(s) | Ctrl+C to stop`));
    console.log(chalk.gray("  ─".repeat(30)));
    console.log("");

    // Show last N lines from each file
    for (const file of targetFiles.slice(0, 5)) { // Max 5 files to avoid flooding
      const filePath = path.join(logDir, file);
      const colorFn = getServiceColor(file);
      const label = getServiceLabel(file);

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").filter(Boolean);
        const lastLines = lines.slice(-tailLines);

        if (lastLines.length > 0) {
          console.log(colorFn(`── ${label} (${file}) ${"─".repeat(Math.max(0, 50 - file.length))}`));
          for (const line of lastLines) {
            console.log(`${colorFn(`[${label}]`)} ${line}`);
          }
          console.log("");
        }
      } catch { /* skip unreadable files */ }
    }

    // Start watching for new content
    console.log(chalk.gray("  ═══ Watching for new log entries... ═══"));
    console.log("");

    const watchers: fs.FSWatcher[] = [];
    const filePositions = new Map<string, number>();

    for (const file of targetFiles.slice(0, 5)) {
      const filePath = path.join(logDir, file);
      const colorFn = getServiceColor(file);
      const label = getServiceLabel(file);

      try {
        const stats = fs.statSync(filePath);
        filePositions.set(filePath, stats.size);

        const watcher = fs.watch(filePath, (eventType) => {
          if (eventType !== "change") return;

          try {
            const newStats = fs.statSync(filePath);
            const prevPos = filePositions.get(filePath) ?? 0;

            if (newStats.size > prevPos) {
              const fd = fs.openSync(filePath, "r");
              const buffer = Buffer.alloc(newStats.size - prevPos);
              fs.readSync(fd, buffer, 0, buffer.length, prevPos);
              fs.closeSync(fd);

              const newContent = buffer.toString("utf-8");
              for (const line of newContent.split("\n")) {
                if (line.trim()) {
                  console.log(`${colorFn(`[${label}]`)} ${line}`);
                }
              }
              filePositions.set(filePath, newStats.size);
            }
          } catch { /* ignore read errors during watch */ }
        });

        watchers.push(watcher);
      } catch { /* skip files that can't be watched */ }
    }

    // Keep process alive until Ctrl+C
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        for (const watcher of watchers) {
          watcher.close();
        }
        console.log("\n" + chalk.gray("Log streaming stopped."));
        resolve();
      });
    });
  });
