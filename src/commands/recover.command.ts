/**
 * @file recover.command.ts
 * @description Recovery and troubleshooting command with guided problem resolution.
 * Includes service restart, tool reinstallation, venv recreation, port conflict
 * resolution, and .env validation.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import {
  intro,
  outro,
  select,
  confirm,
  logSuccess,
  logWarning,
  logError,
  logInfo,
  createSpinner,
} from "../ui/prompts";
import {
  resolveWorkspaceRoot,
  resolveEnvFile,
  resolveComposeFile,
  resolvePidFile,
  resolveLogDir,
  resolveDockerComposeCmd,
  hasTool,
  mergeEnvFile,
} from "../ui/platform";
import { setupMediaWorkerVenv } from "../services/tool-installer";
import { PORTS } from "../utils/config";

interface RecoveryOption {
  id: string;
  label: string;
  hint: string;
  dangerous?: boolean;
}

const recoveryOptions: readonly RecoveryOption[] = [
  {
    id: "restart-service",
    label: "🔄 Restart a Service",
    hint: "Restart a specific service without full reset",
  },
  {
    id: "port-fix",
    label: "🔌 Fix Port Conflicts",
    hint: "Auto-detect and kill processes blocking critical ports",
  },
  {
    id: "env-validate",
    label: "📋 Validate .env Completeness",
    hint: "Check all required keys are present and add missing ones",
  },
  {
    id: "venv-recreate",
    label: "🐍 Recreate Media Worker venv",
    hint: "Delete and recreate the Python virtual environment",
  },
  {
    id: "reinstall-localai",
    label: "🎨 Reinstall LocalAI",
    hint: "Reinstall LocalAI via Homebrew (macOS)",
  },
  {
    id: "docker-clean",
    label: "🐳 Clean Docker Environment",
    hint: "Remove stopped containers and orphaned volumes",
  },
  {
    id: "env-reset",
    label: "🔑 Reset Environment Variables",
    hint: "Regenerate .env file with secure defaults",
  },
  {
    id: "pid-cleanup",
    label: "💀 Cleanup Process IDs",
    hint: "Remove stale PID references and orphaned processes",
  },
  {
    id: "log-cleanup",
    label: "🗑️  Clear Logs",
    hint: "Wipe previous logs to reduce disk usage",
  },
  {
    id: "full-reset",
    label: "💣 Full System Reset",
    hint: "Wipe databases and restart from clean state",
    dangerous: true,
  },
  {
    id: "diagnose-all",
    label: "🔍 Full Diagnostic Report",
    hint: "Run comprehensive system analysis",
  },
];

export const recoverCommand = new Command("recover")
  .description("Diagnose and recover from common issues")
  .action(async () => {
    await intro(chalk.cyan.bold("🥷 Orazaka Recovery & Troubleshooting"));

    const issue = await select({
      message: "What would you like to do?",
      options: recoveryOptions.map((opt) => ({
        value: opt.id,
        label: opt.label,
        hint: opt.hint,
      })),
    });

    const workspaceRoot = resolveWorkspaceRoot();
    const spinner = await createSpinner();

    switch (issue) {
      // ─── Restart a specific service ─────────────────────────
      case "restart-service": {
        const service = await select({
          message: "Which service to restart?",
          options: [
            { value: "docker", label: "Docker Middleware (Postgres, Redis, RabbitMQ)", hint: "Restart all Docker containers" },
            { value: "ollama", label: "Ollama (LLM Engine)", hint: "Restart Ollama serve" },
            { value: "localai", label: "LocalAI (Image Worker)", hint: "Restart LocalAI process" },
            { value: "media", label: "Media Worker", hint: "Restart the Python media worker" },
          ],
        });

        if (service === "docker") {
          const composeFile = resolveComposeFile();
          const dockerComposeCmd = resolveDockerComposeCmd();
          if (dockerComposeCmd && fs.existsSync(composeFile)) {
            spinner.start("Restarting Docker containers...");
            try {
              execSync(`${dockerComposeCmd} -p orazaka -f "${composeFile}" restart`, { stdio: "ignore" });
              spinner.stop("Docker containers restarted.");
              await logSuccess("✔ Docker middleware restarted");
            } catch {
              spinner.stop("Restart failed", 1);
              await logError("Failed to restart Docker containers");
            }
          }
        } else if (service === "ollama") {
          spinner.start("Restarting Ollama...");
          try {
            execSync("pkill -f 'ollama serve' || true", { stdio: "ignore" });
            await new Promise((r) => setTimeout(r, 2000));
            if (process.platform === "darwin") {
              execSync("open -a Ollama", { stdio: "ignore" });
            } else if (hasTool("ollama")) {
              execSync("nohup ollama serve > /dev/null 2>&1 &", { stdio: "ignore" });
            }
            spinner.stop("Ollama restarted.");
            await logSuccess("✔ Ollama restarted");
          } catch {
            spinner.stop("Restart failed", 1);
          }
        } else if (service === "localai") {
          spinner.start("Restarting LocalAI...");
          try {
            execSync("pkill -f 'local-ai' || true", { stdio: "ignore" });
            await new Promise((r) => setTimeout(r, 2000));
            await logInfo("LocalAI stopped. Restart via: npx orazaka start --only localai");
            spinner.stop("LocalAI stopped.");
          } catch {
            spinner.stop("Restart failed", 1);
          }
        } else if (service === "media") {
          spinner.start("Restarting Media Worker...");
          try {
            execSync("pkill -f 'orazaka-worker-media.*main.py' || true", { stdio: "ignore" });
            await new Promise((r) => setTimeout(r, 2000));
            await logInfo("Media Worker stopped. Restart via: npx orazaka start --only media-worker");
            spinner.stop("Media Worker stopped.");
          } catch {
            spinner.stop("Restart failed", 1);
          }
        }
        break;
      }

      // ─── Fix port conflicts (auto-kill) ─────────────────────
      case "port-fix": {
        spinner.start("Scanning for port conflicts...");
        const criticalPorts = [
          { port: PORTS.postgres, name: "PostgreSQL" },
          { port: PORTS.redis, name: "Redis" },
          { port: PORTS.rabbitmq, name: "RabbitMQ" },
          { port: PORTS.router, name: "Router API" },
          { port: PORTS.web, name: "Frontend UI" },
          { port: PORTS.ollama, name: "Ollama" },
          { port: PORTS.localai, name: "LocalAI" },
          { port: PORTS.mediaWorker, name: "Media Worker" },
        ];

        const conflicts: Array<{ port: number; name: string; pid: string }> = [];

        for (const service of criticalPorts) {
          try {
            if (process.platform !== "win32") {
              const pids = execSync(`lsof -i :${String(service.port)} -t 2>/dev/null || true`)
                .toString().trim();
              if (pids) {
                conflicts.push({ ...service, pid: pids.split("\n")[0]! });
              }
            }
          } catch { /* no conflict */ }
        }

        spinner.stop();

        if (conflicts.length === 0) {
          await logSuccess("✔ No port conflicts detected.");
        } else {
          await logWarning(`Found ${String(conflicts.length)} port conflict(s):`);
          for (const c of conflicts) {
            console.log(`  ${chalk.red("✖")} Port ${String(c.port)} (${c.name}) — PID ${c.pid}`);
          }

          const shouldKill = await confirm({
            message: "Kill all conflicting processes?",
            initialValue: false,
          });

          if (shouldKill === true) {
            for (const c of conflicts) {
              try {
                execSync(`kill -9 ${c.pid}`, { stdio: "ignore" });
                await logSuccess(`Killed PID ${c.pid} (port ${String(c.port)})`);
              } catch {
                await logWarning(`Could not kill PID ${c.pid}`);
              }
            }
          }
        }
        break;
      }

      // ─── Validate .env completeness ─────────────────────────
      case "env-validate": {
        const envFile = resolveEnvFile();
        if (!fs.existsSync(envFile)) {
          await logError(".env not found. Run npx orazaka init first.");
          break;
        }

        spinner.start("Validating .env...");
        const requiredKeys = [
          "PORT", "SPRING_DATASOURCE_URL", "SPRING_DATASOURCE_USERNAME",
          "SPRING_DATASOURCE_PASSWORD", "REDIS_URL", "RABBITMQ_HOST",
          "RABBITMQ_PORT", "DEFAULT_PROVIDER", "OLLAMA_BASE_URL",
          "OLLAMA_MODEL", "CRYPTO_KEY", "CRYPTO_SALT", "VIDEO_WORKER_PORT",
          "IMAGE_WORKER_PORT", "LOCALAI_PORT", "LOG_DIR", "UPLOAD_DIR",
        ];

        const defaults: Record<string, string> = {};
        for (const key of requiredKeys) {
          defaults[key] = `PLACEHOLDER_${key}`;
        }
        // Use meaningful defaults
        defaults["PORT"] = "8080";
        defaults["VIDEO_WORKER_PORT"] = "8188";
        defaults["IMAGE_WORKER_PORT"] = "8085";
        defaults["LOCALAI_PORT"] = "8085";
        defaults["LOG_DIR"] = "var/logs";
        defaults["UPLOAD_DIR"] = "var/orazaka-uploads";
        defaults["DEFAULT_PROVIDER"] = "ollama";
        defaults["OLLAMA_BASE_URL"] = "http://localhost:11434";
        defaults["OLLAMA_MODEL"] = "phi3:mini";
        defaults["RABBITMQ_PORT"] = "5672";
        defaults["RABBITMQ_HOST"] = "localhost";
        defaults["REDIS_URL"] = "redis://localhost:6379";

        const added = mergeEnvFile(envFile, defaults);
        spinner.stop();

        if (added.length === 0) {
          await logSuccess("✔ .env is complete — all required keys present");
        } else {
          await logSuccess(`Added ${String(added.length)} missing key(s): ${chalk.gray(added.join(", "))}`);
          await logWarning("Review the added keys and update placeholder values.");
        }
        break;
      }

      // ─── Recreate media worker venv ─────────────────────────
      case "venv-recreate": {
        const venvPath = path.join(workspaceRoot, "orazaka-apps", "workers", "orazaka-worker-media", ".venv");

        if (fs.existsSync(venvPath)) {
          const shouldDelete = await confirm({
            message: `Delete existing venv at ${path.relative(workspaceRoot, venvPath)}?`,
            initialValue: true,
          });

          if (shouldDelete === true) {
            spinner.start("Removing existing venv...");
            fs.rmSync(venvPath, { recursive: true, force: true });
            spinner.stop("Old venv removed.");
          } else {
            break;
          }
        }

        spinner.start("Creating new Python venv...");
        const result = setupMediaWorkerVenv(workspaceRoot);
        if (result.success) {
          spinner.stop("Venv created.");
          await logSuccess(`✔ Media worker venv ready at ${path.relative(workspaceRoot, result.venvPath)}`);
        } else {
          spinner.stop("Failed", 1);
          await logError(`Could not create venv: ${result.error ?? "unknown error"}`);
        }
        break;
      }

      // ─── Reinstall LocalAI ──────────────────────────────────
      case "reinstall-localai": {
        if (process.platform !== "darwin") {
          await logWarning("LocalAI Homebrew installation is only available on macOS.");
          break;
        }
        if (!hasTool("brew")) {
          await logError("Homebrew not found. Install from https://brew.sh");
          break;
        }

        spinner.start("Reinstalling LocalAI...");
        try {
          execSync("brew reinstall localai", { stdio: "inherit" });
          spinner.stop("LocalAI reinstalled.");
          await logSuccess("✔ LocalAI reinstalled via Homebrew");
        } catch {
          spinner.stop("Reinstall failed", 1);
          await logError("Failed to reinstall LocalAI");
        }
        break;
      }

      // ─── Docker clean ───────────────────────────────────────
      case "docker-clean": {
        spinner.start("Cleaning Docker environment...");
        try {
          execSync("docker container prune -f", { stdio: "ignore" });
          execSync("docker volume prune -f", { stdio: "ignore" });
          spinner.stop("Docker environment cleaned.");
          await logSuccess("✔ Removed orphaned containers and volumes.");
        } catch {
          spinner.stop("Cleanup failed", 1);
        }
        break;
      }

      // ─── Env reset ──────────────────────────────────────────
      case "env-reset": {
        const envFile = resolveEnvFile();
        const backup = `${envFile}.backup`;

        if (fs.existsSync(envFile)) {
          fs.copyFileSync(envFile, backup);
          await logSuccess(`✔ Backed up existing .env to ${path.basename(backup)}`);
        }

        spinner.start("Regenerating .env...");
        try {
          execSync("npx orazaka init --force --yes", { stdio: "ignore" });
          spinner.stop(".env regenerated.");
          await logSuccess("✔ Environment reset complete.");
        } catch {
          spinner.stop("Reset failed", 1);
          await logError("Could not regenerate .env file.");
        }
        break;
      }

      // ─── PID cleanup ────────────────────────────────────────
      case "pid-cleanup": {
        const pidFile = resolvePidFile();
        spinner.start("Cleaning up process IDs...");

        if (fs.existsSync(pidFile)) {
          const pids = fs.readFileSync(pidFile, "utf-8").split("\n");
          let killed = 0;

          for (const pidEntry of pids) {
            if (!pidEntry.trim()) continue;
            const pidNum = pidEntry.split("=")[1];
            if (!pidNum) continue;

            try {
              process.kill(parseInt(pidNum), "SIGTERM");
              killed++;
            } catch { /* already dead */ }
          }

          fs.unlinkSync(pidFile);
          spinner.stop(`Cleaned up ${String(killed)} process(es).`);
          await logSuccess(`✔ Removed ${String(killed)} stale process references.`);
        } else {
          spinner.stop("No PID file found.");
          await logWarning("No stale processes to clean.");
        }
        break;
      }

      // ─── Log cleanup ────────────────────────────────────────
      case "log-cleanup": {
        const logDir = resolveLogDir();
        spinner.start("Clearing logs...");

        if (fs.existsSync(logDir)) {
          const files = fs.readdirSync(logDir);
          let deleted = 0;

          for (const file of files) {
            fs.unlinkSync(path.join(logDir, file));
            deleted++;
          }

          spinner.stop(`Deleted ${String(deleted)} log file(s).`);
          await logSuccess(`✔ Cleaned ${String(deleted)} log file(s).`);
        } else {
          spinner.stop("Log directory not found.");
        }
        break;
      }

      // ─── Full reset ─────────────────────────────────────────
      case "full-reset": {
        await logWarning("This will delete all databases and application state.");
        const confirmed = await confirm({
          message: "Are you absolutely sure?",
          initialValue: false,
        });

        if (confirmed !== true) {
          await outro(chalk.yellow("Reset cancelled."));
          return;
        }

        spinner.start("Removing Docker volumes and databases...");
        try {
          execSync("docker volume prune -f", { stdio: "ignore" });
          execSync("docker system prune -f", { stdio: "ignore" });
          spinner.stop("Docker cleanup complete.");
          await logSuccess("✔ Full reset complete. Run npx orazaka start to rebuild.");
        } catch {
          spinner.stop("Cleanup failed", 1);
          await logError("Some cleanup operations failed.");
        }
        break;
      }

      // ─── Diagnose all ───────────────────────────────────────
      case "diagnose-all": {
        spinner.start("Running full diagnostics...");
        try {
          execSync("npx orazaka doctor --verbose", { stdio: "inherit" });
          spinner.stop();
        } catch {
          spinner.stop("Diagnostics failed", 1);
        }
        break;
      }
    }

    await outro(chalk.cyan("Recovery operations complete."));
  });
