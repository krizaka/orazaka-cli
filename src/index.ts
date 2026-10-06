#!/usr/bin/env node
/**
 * @file index.ts
 * @description Main entry point and bootstrap registry for the Orazaka CLI.
 * Registers all commands, displays the startup banner, and provides graceful error handling.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { VersionManager } from "./services/version-manager";

import { loginCommand } from "./commands/login.command";
import { registerCommand } from "./commands/register.command";
import { verifyCommand } from "./commands/verify.command";
import { forgotCommand } from "./commands/forgot.command";
import { resetCommand } from "./commands/reset.command";
import { chatCommand } from "./commands/chat.command";
import { settingsCommand } from "./commands/settings.command";
import { profileCommand } from "./commands/profile.command";
import { videoCommand } from "./commands/video.command";
import { graphCommand } from "./commands/graph.command";
import { studioCommand } from "./commands/studio.command";
import { packCommand } from "./commands/pack.command";
import { mcpCommand } from "./commands/mcp.command";
import { initCommand } from "./commands/init.command";
import { doctorCommand } from "./commands/doctor.command";
import { startCommand } from "./commands/start.command";
import { recoverCommand } from "./commands/recover.command";
import { stopCommand } from "./commands/stop.command";
import { configCommand } from "./commands/config.command";
import { agentCommand } from "./commands/agent.command";
import { installCommand } from "./commands/install.command";
import { generateCommand } from "./commands/generate.command";
import { logsCommand } from "./commands/logs.command";
import { statusCommand } from "./commands/status.command";
import { devCommand } from "./commands/dev.command";
import { onboardCommand } from "./commands/onboard.command";
import { testCommand } from "./commands/test.command";
import { docsCommand } from "./commands/docs.command";
import { dbCommand } from "./commands/db.command";
import { modelsCommand } from "./commands/models.command";

function getVersion(): string {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg?.version ?? "UNKNOWN";
}

const VERSION = getVersion();

function getBanner(): string {
  const v = `v${VERSION}`;
  return `
${chalk.cyan("  ┌──────────────────────────────────────────────┐")}
${chalk.cyan("  │")}                                              ${chalk.cyan("│")}
${chalk.cyan("  │")}   ${chalk.white.bold("🥷  O R A S A K A")}   ${chalk.gray(v.padEnd(8))}              ${chalk.cyan("│")}
${chalk.cyan("  │")}   ${chalk.gray("Sovereign AI Orchestration Engine")}         ${chalk.cyan("│")}
${chalk.cyan("  │")}                                              ${chalk.cyan("│")}
${chalk.cyan("  └──────────────────────────────────────────────┘")}
`;
}

function getHelpFooter(): string {
  return `
${chalk.cyan.bold("Quick Start:")}
  ${chalk.white("$")} npx orazaka init         ${chalk.gray("Initialize workspace")}
  ${chalk.white("$")} npx orazaka install      ${chalk.gray("Verify tools & setup topology")}
  ${chalk.white("$")} npx orazaka start        ${chalk.gray("Launch infrastructure (dev mode)")}
  ${chalk.white("$")} npx orazaka dev          ${chalk.gray("Launch full dev stack in parallel")}
  ${chalk.white("$")} npx orazaka status       ${chalk.gray("Check service health")}

${chalk.cyan.bold("Development:")}
  ${chalk.white("$")} npx orazaka generate     ${chalk.gray("Scaffold features & interceptors")}
  ${chalk.white("$")} npx orazaka logs         ${chalk.gray("Stream real-time logs")}
  ${chalk.white("$")} npx orazaka recover      ${chalk.gray("Diagnose & fix issues")}
  ${chalk.white("$")} npx orazaka doctor       ${chalk.gray("Full system diagnostics")}

${chalk.cyan.bold("Documentation:")}
  ${chalk.gray("https://github.com/oussamaABID/orazaka/blob/main/docs/_generated/CLI.md")}
`;
}

const program = new Command("orazaka");

program
  .version(VERSION)
  .description("Orazaka AI CLI — Sovereign multi-modal AI orchestration from your terminal")
  .addHelpText("before", getBanner())
  .addHelpText("after", getHelpFooter())
  // ─── Lifecycle Commands ────────────────────────────────
  .addCommand(initCommand)
  .addCommand(installCommand)
  .addCommand(doctorCommand)
  .addCommand(configCommand)
  .addCommand(startCommand)
  .addCommand(stopCommand)
  .addCommand(onboardCommand)
  // ─── Recovery & Troubleshooting ─────────────────────────
  .addCommand(recoverCommand)
  // ─── Observability ──────────────────────────────────────
  .addCommand(logsCommand)
  .addCommand(statusCommand)
  .addCommand(modelsCommand)
  .addCommand(dbCommand)
  // ─── Development & Code Generation ──────────────────────
  .addCommand(generateCommand)
  .addCommand(devCommand)
  .addCommand(testCommand)
  .addCommand(docsCommand)
  // ─── Auth Commands ─────────────────────────────────────
  .addCommand(loginCommand)
  .addCommand(registerCommand)
  .addCommand(verifyCommand)
  .addCommand(forgotCommand)
  .addCommand(resetCommand)
  // ─── Core Commands ─────────────────────────────────────
  .addCommand(chatCommand)
  .addCommand(settingsCommand)
  .addCommand(profileCommand)
  .addCommand(videoCommand)
  .addCommand(graphCommand)
  .addCommand(studioCommand)
  .addCommand(packCommand)
  .addCommand(mcpCommand)
  .addCommand(agentCommand);

// Check for CLI updates (non-blocking, background check)
async function checkVersionAsync(): Promise<void> {
  try {
    // Skip if suppressed (CI/CD environments)
    if (process.env.ORAZAKA_SKIP_VERSION_CHECK === "true") {
      return;
    }

    const versionManager = new VersionManager(VERSION);

    // Don't block startup - check in background with timeout
    const checkPromise = versionManager.checkForUpdates();
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 2000); // 2 second timeout
    });

    const result = await Promise.race([
      checkPromise.then((info) => ({ success: true as const, info })),
      timeoutPromise.then(() => ({ success: false as const, info: undefined })),
    ]);

    if (result.success && result.info) {
      const lines = versionManager.formatUpdateNotification(result.info);
      for (const line of lines) {
        console.log(line);
      }
    }
  } catch {
    // Silently fail - don't break CLI if version check fails
  }
}

// Graceful execution entry point
async function main(): Promise<void> {
  // Check for updates (non-blocking)
  checkVersionAsync().catch(() => {
    // Ignore errors from version check
  });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(chalk.red(`\n❌ Fatal Error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
