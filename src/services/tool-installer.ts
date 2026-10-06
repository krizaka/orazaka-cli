/**
 * @file tool-installer.ts
 * @description Centralized tool detection, version verification, and guided
 * installation service. Platform-aware — provides macOS Homebrew, Linux apt,
 * and manual download hints for each required tool.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { hasTool } from "../utils/platform";

/** Describes a single tool requirement. */
export interface ToolRequirement {
  readonly name: string;
  readonly command: string;
  readonly versionCmd: string;
  readonly minVersion: string;
  readonly description: string;
  readonly critical: boolean;
  readonly brewFormula?: string;
  readonly aptPackage?: string;
  readonly downloadUrl: string;
  readonly category: "runtime" | "ai" | "media" | "build" | "infra";
}

/** Result of checking a single tool. */
export interface ToolCheckResult {
  readonly tool: ToolRequirement;
  readonly available: boolean;
  readonly version: string | null;
  readonly versionOk: boolean;
  readonly installHint: string;
}

/** Aggregate report for all tools. */
export interface ToolReport {
  readonly results: readonly ToolCheckResult[];
  readonly allCriticalMet: boolean;
  readonly missingCritical: readonly ToolCheckResult[];
  readonly missingOptional: readonly ToolCheckResult[];
}

/** All required tools for Orazaka. */
export function getRequiredTools(): ToolRequirement[] {
  const tools: ToolRequirement[] = [
    {
      name: "Docker",
      command: "docker",
      versionCmd: "docker --version",
      minVersion: "20.0.0",
      description: "Container runtime for middleware (Postgres, Redis, RabbitMQ)",
      critical: true,
      brewFormula: "docker",
      aptPackage: "docker.io",
      downloadUrl: "https://www.docker.com/products/docker-desktop",
      category: "infra",
    },
    {
      name: "Docker Compose",
      command: "docker",
      versionCmd: "docker compose version",
      minVersion: "2.0.0",
      description: "Multi-container orchestration",
      critical: true,
      downloadUrl: "https://docs.docker.com/compose/install/",
      category: "infra",
    },
    {
      name: "Java 21",
      command: "java",
      versionCmd: "java --version 2>&1",
      minVersion: "21.0.0",
      description: "JVM runtime for the Router and workers",
      critical: true,
      brewFormula: "openjdk@21",
      aptPackage: "openjdk-21-jdk",
      downloadUrl: "https://adoptium.net",
      category: "runtime",
    },
    {
      name: "Node.js",
      command: "node",
      versionCmd: "node --version",
      minVersion: "20.0.0",
      description: "JavaScript runtime for CLI and Next.js UI",
      critical: true,
      brewFormula: "node",
      aptPackage: "nodejs",
      downloadUrl: "https://nodejs.org",
      category: "runtime",
    },
    {
      name: "Ollama",
      command: "ollama",
      versionCmd: "ollama --version",
      minVersion: "0.1.0",
      description: "Local LLM inference engine",
      critical: true,
      brewFormula: "ollama",
      downloadUrl: "https://ollama.ai",
      category: "ai",
    },
    {
      name: "Python 3",
      command: "python3",
      versionCmd: "python3 --version",
      minVersion: "3.11.0",
      description: "Required for the media generation worker",
      critical: false,
      brewFormula: "python@3.11",
      aptPackage: "python3.11",
      downloadUrl: "https://python.org",
      category: "runtime",
    },
    {
      name: "FFmpeg",
      command: "ffmpeg",
      versionCmd: "ffmpeg -version",
      minVersion: "5.0.0",
      description: "Video encoding for cinematic output",
      critical: false,
      brewFormula: "ffmpeg",
      aptPackage: "ffmpeg",
      downloadUrl: "https://ffmpeg.org/download.html",
      category: "media",
    },
    {
      name: "Git",
      command: "git",
      versionCmd: "git --version",
      minVersion: "2.30.0",
      description: "Version control",
      critical: false,
      brewFormula: "git",
      aptPackage: "git",
      downloadUrl: "https://git-scm.com",
      category: "build",
    },
  ];

  // Add LocalAI only on macOS (M1/M2/M3)
  if (process.platform === "darwin") {
    tools.push({
      name: "LocalAI",
      command: "local-ai",
      versionCmd: "local-ai --version",
      minVersion: "1.0.0",
      description: "GPU-accelerated image generation (Metal MPS on Apple Silicon)",
      critical: false,
      brewFormula: "localai",
      downloadUrl: "https://localai.io/docs/getting-started/",
      category: "ai",
    });
  }

  return tools;
}

/**
 * Extracts a semver-like version from a version string.
 * Handles formats like "v20.1.0", "Docker version 20.10.7", "openjdk 21.0.1", etc.
 */
function extractVersion(versionStr: string): string | null {
  const match = versionStr.match(/(\d+)\.(\d+)\.?(\d*)/);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3] || "0"}`;
}

/**
 * Compares two semver strings. Returns true if actual >= required.
 */
function isVersionSatisfied(actual: string, required: string): boolean {
  const aParts = actual.split(".").map(Number);
  const rParts = required.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const a = aParts[i] ?? 0;
    const r = rParts[i] ?? 0;
    if (a > r) return true;
    if (a < r) return false;
  }
  return true; // Equal
}

/**
 * Returns a platform-aware install hint for a tool.
 */
function getInstallHint(tool: ToolRequirement): string {
  if (process.platform === "darwin" && tool.brewFormula) {
    return `brew install ${tool.brewFormula}`;
  }
  if (process.platform === "linux" && tool.aptPackage) {
    return `sudo apt-get install ${tool.aptPackage}`;
  }
  return tool.downloadUrl;
}

/**
 * Checks a single tool's availability and version.
 */
export function checkTool(tool: ToolRequirement): ToolCheckResult {
  const available = hasTool(tool.command);

  if (!available) {
    return {
      tool,
      available: false,
      version: null,
      versionOk: false,
      installHint: getInstallHint(tool),
    };
  }

  let version: string | null;
  let versionOk: boolean;

  try {
    const raw = execSync(tool.versionCmd, { stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim()
      .split("\n")[0] ?? "";
    version = extractVersion(raw);
    versionOk = version ? isVersionSatisfied(version, tool.minVersion) : true;
  } catch {
    version = "unknown";
    versionOk = true; // Can't verify, assume OK
  }

  return {
    tool,
    available: true,
    version,
    versionOk,
    installHint: getInstallHint(tool),
  };
}

/**
 * Runs a full tool scan and returns a structured report.
 */
export function detectAllTools(): ToolReport {
  const tools = getRequiredTools();
  const results = tools.map(checkTool);

  const missingCritical = results.filter(
    (r) => r.tool.critical && (!r.available || !r.versionOk),
  );
  const missingOptional = results.filter(
    (r) => !r.tool.critical && (!r.available || !r.versionOk),
  );

  return {
    results,
    allCriticalMet: missingCritical.length === 0,
    missingCritical,
    missingOptional,
  };
}

/**
 * Attempts to install a tool via Homebrew (macOS only).
 * Returns true on success, false on failure.
 */
export function installViaBrew(formula: string): boolean {
  if (process.platform !== "darwin") return false;
  if (!hasTool("brew")) return false;

  try {
    execSync(`brew install ${formula}`, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

/** Absolute path to the native Python media worker (orazaka-worker-media). */
function mediaWorkerDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, "orazaka-apps", "workers", "orazaka-worker-media");
}

/**
 * Sets up a Python virtual environment for the media worker.
 * Creates .venv if it doesn't exist and installs requirements.
 */
export function setupMediaWorkerVenv(workspaceRoot: string): {
  success: boolean;
  venvPath: string;
  error?: string;
} {
  const workerDir = mediaWorkerDir(workspaceRoot);
  const requirementsFile = path.join(workerDir, "requirements.txt");
  const venvPath = path.join(workerDir, ".venv");

  if (!fs.existsSync(requirementsFile)) {
    return {
      success: false,
      venvPath,
      error: "requirements.txt not found in media worker directory",
    };
  }

  if (!hasTool("python3")) {
    return {
      success: false,
      venvPath,
      error: "python3 not found on PATH",
    };
  }

  try {
    // Create venv if it doesn't exist
    if (!fs.existsSync(venvPath)) {
      execSync(`python3 -m venv "${venvPath}"`, {
        cwd: workerDir,
        stdio: "pipe",
      });
    }

    // Install requirements
    const pipPath = path.join(venvPath, "bin", "pip");
    execSync(`"${pipPath}" install -r requirements.txt`, {
      cwd: workerDir,
      stdio: "pipe",
    });

    return { success: true, venvPath };
  } catch (err) {
    return {
      success: false,
      venvPath,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Resolves the Python executable for the media worker.
 * Prefers .venv/bin/python3, falls back to system python3.
 */
export function resolveMediaWorkerPython(workspaceRoot: string): string | null {
  const venvPython = path.join(mediaWorkerDir(workspaceRoot), ".venv", "bin", "python3");

  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  if (hasTool("python3")) {
    return "python3";
  }

  return null;
}

/**
 * Formats a ToolCheckResult for display.
 */
export function formatToolResult(result: ToolCheckResult): string {
  if (result.available && result.versionOk) {
    return `${chalk.green("✔")} ${result.tool.name.padEnd(18)} ${chalk.gray(result.version ?? "installed")}`;
  }
  if (result.available && !result.versionOk) {
    return `${chalk.yellow("⚠")} ${result.tool.name.padEnd(18)} ${chalk.yellow(result.version ?? "?")} ${chalk.gray(`(need ${result.tool.minVersion}+)`)}`;
  }
  const icon = result.tool.critical ? chalk.red("✖") : chalk.yellow("○");
  return `${icon} ${result.tool.name.padEnd(18)} ${chalk.gray("not found")} → ${chalk.cyan(result.installHint)}`;
}
