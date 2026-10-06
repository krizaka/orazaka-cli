/**
 * @file platform.ts
 * @description Cross-platform utility functions for CLI operations.
 * All host-level detection and path resolution logic is centralized here.
 * Zero hardcoded paths — everything is dynamically resolved.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { execSync } from "node:child_process";

/** Supported shell platforms for tool detection. */
type Platform = "darwin" | "win32" | "linux" | string;

/**
 * Detects whether a CLI tool exists on the host PATH.
 * Uses cross-platform-safe `which` or `where` depending on OS.
 */
export function hasTool(tool: string): boolean {
  try {
    const cmd = process.platform === "win32" ? `where ${tool}` : `command -v ${tool}`;
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the version string of a tool if available.
 */
export function getToolVersion(tool: string): string {
  try {
    const versionFlags: Record<string, string> = {
      docker: "docker --version",
      python3: "python3 --version",
      python: "python --version",
      aws: "aws --version",
      terraform: "terraform -version",
      modal: "modal --version",
      node: "node --version",
      npm: "npm --version",
      java: "java --version 2>&1",
      mvn: "mvn --version",
      git: "git --version",
      ollama: "ollama --version",
    };

    const cmd = versionFlags[tool] ?? `${tool} --version`;
    return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"] }).toString().trim().split("\n")[0] ?? "Installed";
  } catch {
    return "Installed";
  }
}

/** Workspace detection result. */
export interface WorkspaceDetection {
  readonly isWorkspace: boolean;
  readonly root: string;
  readonly markers: readonly string[];
  readonly missing: readonly string[];
}

/** The manifest at the root of an Orazaka workspace (krizaka/orazaka). */
export const WORKSPACE_MANIFEST = "orazaka.workspace.json";

/** Markers that indicate an Orazaka workspace. */
const WORKSPACE_MARKERS = [WORKSPACE_MANIFEST, "pom.xml", "orazaka-libs", "orazaka-apps", "AGENTS.md"] as const;

/**
 * Detects whether a directory is an Orazaka workspace.
 * Scans for orazaka.workspace.json, pom.xml, orazaka-libs/, orazaka-apps/, AGENTS.md.
 */
export function detectOrazakaWorkspace(dir: string): WorkspaceDetection {
  const found: string[] = [];
  const missing: string[] = [];

  for (const marker of WORKSPACE_MARKERS) {
    if (fs.existsSync(path.join(dir, marker))) {
      found.push(marker);
    } else {
      missing.push(marker);
    }
  }

  return {
    isWorkspace: found.length >= 2, // At least 2 markers present
    root: dir,
    markers: found,
    missing,
  };
}

/**
 * Walks up from cwd() looking for an Orazaka workspace root.
 * Returns cwd() if none found.
 */
export function resolveWorkspaceRootSmart(): string {
  let current = process.cwd();
  const root = path.parse(current).root;

  while (current !== root) {
    const detection = detectOrazakaWorkspace(current);
    if (detection.isWorkspace) {
      return current;
    }
    current = path.dirname(current);
  }

  // Fallback: use cwd()
  return process.cwd();
}

/**
 * The Orazaka workspace this CLI runs from: the nearest directory above {@code start} holding
 * {@link WORKSPACE_MANIFEST}. Every repository of the platform is cloned under it, so the CLI's own
 * position (orazaka-apps/ui/orazaka-cli) is not what defines it.
 */
export function resolveWorkspaceFrom(start: string): string {
  let current = path.resolve(start);
  const top = path.parse(current).root;
  while (current !== top) {
    if (fs.existsSync(path.join(current, WORKSPACE_MANIFEST))) {
      return current;
    }
    current = path.dirname(current);
  }
  // Not inside a workspace: the layout the CLI ships in (orazaka-apps/ui/orazaka-cli/dist/<dir>).
  return path.resolve(start, "..", "..", "..", "..", "..");
}

/** Resolves the workspace root directory for the Orazaka project. */
export function resolveWorkspaceRoot(): string {
  return resolveWorkspaceRootSmart();
}

/** Resolves the var/ operational directory. */
export function resolveVarDir(): string {
  return path.join(resolveWorkspaceRoot(), "var");
}

/** Resolves the logs directory inside var/. */
export function resolveLogDir(): string {
  return path.join(resolveVarDir(), "logs");
}

/** Resolves the PID state file path. */
export function resolvePidFile(): string {
  return path.join(resolveVarDir(), ".orazaka.pid");
}

/** Resolves docker-compose file path. */
export function resolveComposeFile(): string {
  return path.join(resolveWorkspaceRoot(), "infra", "docker-compose.yml");
}

/** Resolves the .env file path. */
export function resolveEnvFile(): string {
  return path.join(resolveWorkspaceRoot(), ".env");
}

/** Resolves the models directory using the home dir. */
export function resolveModelsDir(): string {
  return path.join(os.homedir(), "models", "stable-diffusion");
}

/** Gets current platform identifier. */
export function getPlatform(): Platform {
  return process.platform;
}

/** Checks if running on Apple Silicon. */
export function isAppleSilicon(): boolean {
  return process.platform === "darwin" && os.arch() === "arm64";
}

/** Returns system info for diagnostics. */
export interface SystemInfo {
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly totalMemoryGb: number;
  readonly nodeVersion: string;
  readonly isAppleSilicon: boolean;
  readonly hostname: string;
}

export function getSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? "Unknown CPU",
    totalMemoryGb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    nodeVersion: process.version,
    isAppleSilicon: isAppleSilicon(),
    hostname: os.hostname(),
  };
}

/** Ensures a directory exists, creating it recursively if needed. */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/** Reads and parses a .env file into a key-value record. */
export function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.substring(0, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Merges default env values into an existing .env file.
 * Only adds keys that are missing — never overwrites existing values.
 * Returns the list of keys that were added.
 */
export function mergeEnvFile(filePath: string, defaults: Record<string, string>): string[] {
  const existing = parseEnvFile(filePath);
  const added: string[] = [];
  const toAdd: Record<string, string> = {};

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in existing)) {
      toAdd[key] = value;
      added.push(key);
    }
  }

  if (added.length > 0) {
    // Append missing keys to file
    let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += "\n# ─── Auto-added by CLI (missing keys) ─────────────\n";
    for (const [key, value] of Object.entries(toAdd)) {
      content += `${key}=${value}\n`;
    }
    fs.writeFileSync(filePath, content, "utf-8");
  }

  return added;
}

/** Writes a key-value record back to a .env file, preserving comments. */
export function writeEnvFile(filePath: string, values: Record<string, string>): void {
  let existingContent = "";
  if (fs.existsSync(filePath)) {
    existingContent = fs.readFileSync(filePath, "utf-8");
  }

  const lines = existingContent.split("\n");
  const updatedKeys = new Set<string>();
  const newLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      newLines.push(line);
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      newLines.push(line);
      continue;
    }
    const key = trimmed.substring(0, eqIndex).trim();
    if (key in values) {
      newLines.push(`${key}=${values[key]}`);
      updatedKeys.add(key);
    } else {
      newLines.push(line);
    }
  }

  // Append any new keys not already in the file
  for (const [key, value] of Object.entries(values)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(filePath, newLines.join("\n"), "utf-8");
}

/**
 * Resolves the docker compose command available on the system.
 * Returns null if neither docker-compose nor docker compose is available.
 */
export function resolveDockerComposeCmd(): string | null {
  if (hasTool("docker-compose")) return "docker-compose";
  try {
    execSync("docker compose version", { stdio: "ignore" });
    return "docker compose";
  } catch {
    return null;
  }
}
