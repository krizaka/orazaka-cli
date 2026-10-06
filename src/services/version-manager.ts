/**
 * @file version-manager.ts
 * @description Version management system for Orazaka CLI.
 * Checks for updates, manages version caching, and displays notifications.
 * Inspired by npm, yarn, and GitHub CLI best practices.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import chalk from "chalk";
import { execSync } from "node:child_process";

/**
 * Version information structure.
 */
export interface VersionInfo {
  current: string;
  latest: string;
  isOutdated: boolean;
  isCritical: boolean;
  releaseDate?: string;
  changelog?: string;
}

/**
 * Cached version check structure.
 */
interface VersionCache {
  timestamp: number;
  current: string;
  latest: string;
  changelog?: string;
}

export class VersionManager {
  private cacheDir: string;
  private cachePath: string;
  private currentVersion: string;
  private cacheExpiry: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor(currentVersion: string) {
    this.currentVersion = currentVersion;
    this.cacheDir = path.join(os.homedir(), ".orazaka-cli");
    this.cachePath = path.join(this.cacheDir, "version-cache.json");
    this.ensureCacheDir();
  }

  /**
   * Ensure cache directory exists.
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get current version from package.json.
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }

  /**
   * Read cached version data.
   */
  private readCache(): VersionCache | null {
    try {
      if (!fs.existsSync(this.cachePath)) {
        return null;
      }
      const data = fs.readFileSync(this.cachePath, "utf-8");
      const cache = JSON.parse(data) as VersionCache;

      // Check if cache is still valid
      const now = Date.now();
      if (now - cache.timestamp > this.cacheExpiry) {
        return null;
      }

      return cache;
    } catch {
      return null;
    }
  }

  /**
   * Write cache file.
   */
  private writeCache(data: VersionCache): void {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Silently fail - don't break CLI if cache fails
    }
  }

  /**
   * Fetch latest version from npm registry.
   * Timeout: 3 seconds to avoid blocking startup.
   */
  private async fetchLatestVersion(): Promise<string | null> {
    try {
      const result = execSync(
        "npm view orazaka-cli version --json 2>/dev/null || echo null",
        {
          timeout: 3000,
          encoding: "utf-8",
        }
      ).trim();

      if (result === "null" || !result) {
        return null;
      }

      return result.replace(/"/g, "");
    } catch {
      return null;
    }
  }

  /**
   * Compare two semantic versions.
   * Returns: -1 (v1 < v2), 0 (equal), 1 (v1 > v2)
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map((x) => parseInt(x, 10));
    const parts2 = v2.split(".").map((x) => parseInt(x, 10));

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }

    return 0;
  }

  /**
   * Determine if update is critical (major version bump).
   */
  private isCriticalUpdate(current: string, latest: string): boolean {
    const currentMajor = parseInt(current.split(".")[0], 10);
    const latestMajor = parseInt(latest.split(".")[0], 10);
    return latestMajor > currentMajor;
  }

  /**
   * Check for available updates (with caching).
   */
  async checkForUpdates(): Promise<VersionInfo> {
    // Try cache first
    const cached = this.readCache();
    if (cached) {
      const isOutdated = this.compareVersions(this.currentVersion, cached.latest) < 0;
      return {
        current: this.currentVersion,
        latest: cached.latest,
        isOutdated,
        isCritical: isOutdated && this.isCriticalUpdate(this.currentVersion, cached.latest),
        changelog: cached.changelog,
      };
    }

    // Fetch latest version
    const latest = await this.fetchLatestVersion();

    if (!latest) {
      // Return current version if fetch fails
      return {
        current: this.currentVersion,
        latest: this.currentVersion,
        isOutdated: false,
        isCritical: false,
      };
    }

    // Cache the result
    this.writeCache({
      timestamp: Date.now(),
      current: this.currentVersion,
      latest,
    });

    const isOutdated = this.compareVersions(this.currentVersion, latest) < 0;

    return {
      current: this.currentVersion,
      latest,
      isOutdated,
      isCritical: isOutdated && this.isCriticalUpdate(this.currentVersion, latest),
    };
  }

  /**
   * Build update notification lines (inspired by npm, yarn, homebrew).
   * Returns formatted lines for the caller (command layer) to display.
   */
  formatUpdateNotification(versionInfo: VersionInfo): string[] {
    if (!versionInfo.isOutdated) {
      return [];
    }

    const lines: string[] = [""];

    if (versionInfo.isCritical) {
      // Critical update: Red box
      lines.push(
        chalk.red.bold(
          "╭──────────────────────────────────────────────────────────────╮"
        )
      );
      lines.push(
        chalk.red.bold("│") +
          chalk.red(
            "  ⚠️  CRITICAL UPDATE AVAILABLE                              "
          ) +
          chalk.red.bold("│")
      );
      lines.push(
        chalk.red.bold("│") +
          chalk.red(
            `  Your version: ${versionInfo.current.padEnd(8)} Latest: ${versionInfo.latest} `
          ) +
          chalk.red.bold("│")
      );
      lines.push(
        chalk.red.bold("│") +
          chalk.red(
            "                                                              "
          ) +
          chalk.red.bold("│")
      );
      lines.push(
        chalk.red.bold("│") +
          chalk.red(
            "  Update immediately to get critical fixes and features:    "
          ) +
          chalk.red.bold("│")
      );
      lines.push(
        chalk.red.bold("│") +
          chalk.red("  $ npm install -g orazaka-cli@latest                   ") +
          chalk.red.bold("│")
      );
      lines.push(
        chalk.red.bold("│") +
          chalk.red(
            "  or                                                         "
          ) +
          chalk.red.bold("│")
      );
      lines.push(
        chalk.red.bold("│") +
          chalk.red("  $ brew upgrade orazaka-cli                           ") +
          chalk.red.bold("│")
      );
      lines.push(
        chalk.red.bold(
          "╰──────────────────────────────────────────────────────────────╯"
        )
      );
    } else {
      // Regular update: Yellow box
      lines.push(
        chalk.yellow(
          "╭──────────────────────────────────────────────────────────────╮"
        )
      );
      lines.push(
        chalk.yellow("│") +
          chalk.yellow(
            "  📦 New version available: " +
              versionInfo.latest.padEnd(35) +
              " "
          ) +
          chalk.yellow("│")
      );
      lines.push(
        chalk.yellow("│") +
          chalk.yellow(
            `  Run: $ npm install -g orazaka-cli@${versionInfo.latest}`.padEnd(62) +
              " "
          ) +
          chalk.yellow("│")
      );
      lines.push(
        chalk.yellow(
          "╰──────────────────────────────────────────────────────────────╯"
        )
      );
    }

    lines.push("");
    return lines;
  }

  /**
   * Clear version cache (for testing or manual reset).
   */
  clearCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        fs.unlinkSync(this.cachePath);
      }
    } catch {
      // Silently fail
    }
  }

  /**
   * Get cache file path (for testing).
   */
  getCachePath(): string {
    return this.cachePath;
  }

  /**
   * Suppress version check for this session (for CI/CD).
   */
  isSuppressed(): boolean {
    return process.env.ORAZAKA_SKIP_VERSION_CHECK === "true";
  }
}
