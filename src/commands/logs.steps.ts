/**
 * @file logs.steps.ts
 * @description Pure steps of `orazaka logs`, kept out of the command so each one is small and tested:
 * the duration parser, the file filters, the labels, the sizes and ages, the tail and the appended text.
 */

import * as fs from "node:fs";
import chalk from "chalk";

const HOUR_MS = 60 * 60 * 1000;
const UNIT_MS: Record<string, number> = { m: 60 * 1000, h: HOUR_MS, d: 24 * HOUR_MS };

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

/** Label of a log file's service, by the first fragment its name contains. */
const SERVICE_LABELS: ReadonlyArray<{ fragments: string[]; label: string }> = [
  { fragments: ["router", "gateway"], label: "ROUTER " },
  { fragments: ["ollama"], label: "OLLAMA " },
  { fragments: ["media", "video"], label: "MEDIA  " },
  { fragments: ["image"], label: "IMAGE  " },
  { fragments: ["ui"], label: "UI     " },
];

export function getServiceColor(filename: string): (s: string) => string {
  const lower = filename.toLowerCase();
  const match = Object.entries(SERVICE_COLORS).find(([key]) => lower.includes(key));
  return match ? match[1] : chalk.white;
}

export function getServiceLabel(filename: string): string {
  const match = SERVICE_LABELS.find(({ fragments }) => fragments.some((fragment) => filename.includes(fragment)));
  return match ? match.label : "LOG    ";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** « 12m ago » under an hour, « 3h ago » after. */
export function formatAge(mtimeMs: number, nowMs: number): string {
  const minutes = Math.round((nowMs - mtimeMs) / (1000 * 60));
  return minutes < 60 ? `${String(minutes)}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/** `--since` (`30m`, `1h`, `2d`) in milliseconds; anything else is the default 24 hours. */
export function parseSinceMs(since: string | undefined): number {
  const match = since?.match(/^(\d+)(h|m|d)$/);
  if (!match) return 24 * HOUR_MS;
  return parseInt(match[1]!) * UNIT_MS[match[2]!]!;
}

/** The files whose name contains the service name (case-insensitive); all of them without a service. */
export function filterByService(files: string[], service: string | undefined): string[] {
  if (!service) return files;
  const needle = service.toLowerCase();
  return files.filter((file) => file.toLowerCase().includes(needle));
}

/** The last `count` non-empty lines of a text. */
export function lastLines(content: string, count: number): string[] {
  return content.split("\n").filter(Boolean).slice(-count);
}

/** The non-blank lines of newly appended text. */
export function appendedLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim());
}

/** The bytes of a file from `from` to `to`, as text. */
export function readRange(filePath: string, from: number, to: number): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(to - from);
    fs.readSync(fd, buffer, 0, buffer.length, from);
    return buffer.toString("utf-8");
  } finally {
    fs.closeSync(fd);
  }
}
