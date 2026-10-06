/**
 * @file status.command.ts
 * @description Live dashboard showing all Orazaka service statuses,
 * ports, PIDs, and health indicators.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import {
  intro,
  outro,
  note,
} from "../ui/prompts";
import {
  resolveWorkspaceRoot,
  resolvePidFile,
  resolveLogDir,
  isAppleSilicon,
} from "../ui/platform";
import { isPortInUse } from "../utils/health";
import { readPidFile, isPidAlive } from "../utils/pid";
import { PORTS } from "../utils/config";

interface ServiceEntry {
  readonly name: string;
  readonly port: number;
  readonly category: "middleware" | "ai" | "worker" | "app";
  readonly critical: boolean;
}

const SERVICES: ServiceEntry[] = [
  { name: "PostgreSQL", port: PORTS.postgres, category: "middleware", critical: true },
  { name: "Redis", port: PORTS.redis, category: "middleware", critical: true },
  { name: "RabbitMQ", port: PORTS.rabbitmq, category: "middleware", critical: true },
  { name: "RabbitMQ Mgmt", port: PORTS.rabbitmqMgmt, category: "middleware", critical: false },
  { name: "Ollama", port: PORTS.ollama, category: "ai", critical: true },
  { name: "LocalAI", port: PORTS.localai, category: "worker", critical: false },
  { name: "Image Gen", port: PORTS.imageGen, category: "worker", critical: false },
  { name: "Media Worker", port: PORTS.mediaWorker, category: "worker", critical: false },
  // Every deployable service, not just the two that predate the microservices split: a
  // `status` that reports green while five services are down is worse than no status.
  { name: "Edge", port: PORTS.edge, category: "app", critical: true },
  { name: "Conversation API", port: PORTS.router, category: "app", critical: true },
  { name: "Identity", port: PORTS.identity, category: "app", critical: true },
  { name: "Knowledge", port: PORTS.knowledge, category: "app", critical: false },
  { name: "Job Orchestration", port: PORTS.jobService, category: "app", critical: false },
  { name: "Billing", port: PORTS.billing, category: "app", critical: false },
  { name: "Studio", port: PORTS.studio, category: "app", critical: false },
  { name: "Frontend UI", port: PORTS.web, category: "app", critical: true },
  { name: "Admin Console", port: PORTS.admin, category: "app", critical: false },
];

export const statusCommand = new Command("status")
  .description("Show live status of all Orazaka services")
  .option("--json", "Output status as JSON")
  .option("--watch", "Refresh every 5 seconds")
  .action(async (options: { json?: boolean; watch?: boolean }) => {
    const workspaceRoot = resolveWorkspaceRoot();

    const renderStatus = async (): Promise<void> => {
      const pidFile = resolvePidFile();
      const pids = readPidFile(pidFile);

      const results: Array<{
        name: string;
        port: number;
        status: "running" | "stopped" | "unknown";
        pid: number | null;
        category: string;
      }> = [];

      for (const svc of SERVICES) {
        const portInUse = await isPortInUse(svc.port);
        let pid: number | null = null;

        // Try to find PID from pid file
        const pidKeys = [svc.name.toLowerCase().replace(/\s+/g, "-"), svc.name.toLowerCase()];
        for (const key of pidKeys) {
          if (pids.has(key)) {
            const p = pids.get(key)!;
            if (isPidAlive(p)) pid = p;
            break;
          }
        }

        results.push({
          name: svc.name,
          port: svc.port,
          status: portInUse ? "running" : "stopped",
          pid,
          category: svc.category,
        });
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      // Format table output
      const categoryLabels: Record<string, string> = {
        middleware: "🐳 Docker Middleware",
        ai: "🤖 AI Engines",
        worker: "🎨 Workers",
        app: "📱 Applications",
      };

      const lines: string[] = [];
      let currentCategory = "";

      for (const r of results) {
        if (r.category !== currentCategory) {
          if (currentCategory) lines.push("");
          lines.push(chalk.bold(categoryLabels[r.category] ?? r.category));
          currentCategory = r.category;
        }

        const statusIcon = r.status === "running"
          ? chalk.green("● UP  ")
          : chalk.red("○ DOWN");

        const portStr = chalk.gray(`:${String(r.port)}`);
        const pidStr = r.pid ? chalk.gray(`PID ${String(r.pid)}`) : "";

        lines.push(
          `  ${statusIcon} ${r.name.padEnd(18)} ${portStr.padEnd(16)} ${pidStr}`
        );
      }

      // Summary counts
      const running = results.filter((r) => r.status === "running").length;
      const total = results.length;
      lines.push("");
      lines.push(
        `${chalk.gray("Summary:")} ${chalk.green(String(running))}/${String(total)} services running` +
        (isAppleSilicon() ? ` ${chalk.gray("| Apple Silicon ✔")}` : "")
      );

      await note(lines.join("\n"), "🥷 Orazaka Service Status");
    };

    if (options.watch) {
      console.log(chalk.gray("Refreshing every 5s — Ctrl+C to stop\n"));
      const refresh = async (): Promise<void> => {
        console.clear();
        await renderStatus();
      };

      await refresh();
      const interval = setInterval(() => {
        refresh().catch(() => {});
      }, 5000);

      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => {
          clearInterval(interval);
          resolve();
        });
      });
    } else {
      await intro(chalk.cyan.bold("🥷 Orazaka Status"));
      await renderStatus();

      const logDir = resolveLogDir();
      if (fs.existsSync(logDir)) {
        const logFiles = fs.readdirSync(logDir).filter((f) => f.endsWith(".log"));
        if (logFiles.length > 0) {
          console.log(
            `\n  ${chalk.gray("Logs:")} ${chalk.cyan(`npx orazaka logs`)} (${String(logFiles.length)} file(s) in ${path.relative(workspaceRoot, logDir)})`
          );
        }
      }

      await outro(chalk.gray("Use --watch for live updates"));
    }
  });
