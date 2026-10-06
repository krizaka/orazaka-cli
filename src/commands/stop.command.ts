/**
 * @file stop.command.ts
 * @description Teardown command with progressive status and cross-platform cleanup.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import {
  intro,
  outro,
  confirm,
  logSuccess,
  logWarning,
  createSpinner,
  note,
  handleCancel,
} from "../ui/prompts";
import {
  resolveWorkspaceRoot,
  resolveComposeFile,
  resolvePidFile,
  resolveDockerComposeCmd,
} from "../ui/platform";
import { ALL_PORTS } from "../utils/config";
import { readPidFile } from "../utils/pid";

function terminateProcess(pid: number, _name: string): boolean {
  try {
    process.kill(pid, 0); // Check existence
    process.kill(pid, 15); // SIGTERM

    let alive = true;
    for (let i = 0; i < 5; i++) {
      try {
        process.kill(pid, 0);
        // Small delay without execSync("sleep")
        const start = Date.now();
        while (Date.now() - start < 1000) {
          // Busy wait for 1s — only used during teardown
        }
      } catch {
        alive = false;
        break;
      }
    }

    if (alive) {
      process.kill(pid, 9); // SIGKILL
    }
    return true;
  } catch {
    return false; // Already dead
  }
}

export const stopCommand = new Command("stop")
  .description("Teardown the Orazaka infrastructure — containers, workers, and state")
  .option("--purge", "Also purge database data and upload directories")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (options: { purge?: boolean; yes?: boolean }) => {
    await intro(chalk.red.bold("🛑 Orazaka Infrastructure Teardown"));

    const workspaceRoot = resolveWorkspaceRoot();
    const pidFile = resolvePidFile();

    // Safety confirmation
    if (!options.yes) {
      const shouldContinue = await confirm({
        message: options.purge
          ? "This will stop ALL services AND delete database data. Continue?"
          : "This will stop all running Orazaka services. Continue?",
        initialValue: true,
        active: "Yes, stop everything",
        inactive: "Cancel",
      });
      handleCancel(shouldContinue);
      if (shouldContinue !== true) {
        await outro("Teardown cancelled.");
        return;
      }
    }

    const spinner = await createSpinner();
    let stoppedCount = 0;

    // ─── 1: PID-based teardown ──────────────────────────────
    if (fs.existsSync(pidFile)) {
      spinner.start("Terminating tracked processes...");

      for (const [name, pid] of readPidFile(pidFile)) {
        if (terminateProcess(pid, name)) stoppedCount++;
      }

      try { fs.unlinkSync(pidFile); } catch { /* Ignore */ }
      spinner.stop(`Terminated ${String(stoppedCount)} tracked process(es).`);
    }

    // ─── 2: Port sweep (Unix only) ─────────────────────────
    if (process.platform !== "win32") {
      spinner.start("Sweeping active ports...");

      for (const port of ALL_PORTS) {
        try {
          const pidsStr = execSync(`lsof -i :${String(port)} -t 2>/dev/null`).toString().trim();
          if (pidsStr) {
            for (const pidStr of pidsStr.split("\n")) {
              const pid = parseInt(pidStr.trim(), 10);
              if (isNaN(pid) || pid === process.pid) continue;

              let procName = "";
              try {
                procName = execSync(`ps -p ${String(pid)} -o comm= 2>/dev/null`).toString().trim();
              } catch { /* Ignore */ }

              // Skip Docker daemon
              if (procName.includes("Docker") || procName.includes("com.docker")) continue;

              try {
                process.kill(pid, 9);
                stoppedCount++;
              } catch { /* Ignore */ }
            }
          }
        } catch { /* No process on port */ }
      }
      spinner.stop("Port sweep complete.");
    }

    // ─── 2b: Database purge (optional) ──────────────────────
    if (options.purge) {
      try {
        const dockerPs = execSync("docker ps").toString();
        if (dockerPs.includes("orazaka-db-vector")) {
          spinner.start("Purging database tables...");
          const sql = `
            TRUNCATE TABLE QRTZ_FIRED_TRIGGERS CASCADE;
            TRUNCATE TABLE QRTZ_SIMPLE_TRIGGERS CASCADE;
            TRUNCATE TABLE QRTZ_CRON_TRIGGERS CASCADE;
            TRUNCATE TABLE QRTZ_TRIGGERS CASCADE;
            TRUNCATE TABLE QRTZ_JOB_DETAILS CASCADE;
            TRUNCATE TABLE QRTZ_SCHEDULER_STATE CASCADE;
            TRUNCATE TABLE QRTZ_LOCKS CASCADE;
            TRUNCATE TABLE automation_job_execution_log CASCADE;
            TRUNCATE TABLE connector_credentials CASCADE;
            TRUNCATE TABLE orazaka_chat_sessions CASCADE;
            TRUNCATE TABLE orazaka_jobs CASCADE;
            TRUNCATE TABLE user_mcp_servers CASCADE;
            TRUNCATE TABLE platform_mcp_servers CASCADE;
            TRUNCATE TABLE platform_tool_configs CASCADE;
            TRUNCATE TABLE user_credentials CASCADE;
            TRUNCATE TABLE orazaka_users CASCADE;
            TRUNCATE TABLE orazaka_user_profiles CASCADE;
            TRUNCATE TABLE orazaka_verification_tokens CASCADE;
            TRUNCATE TABLE orazaka_user_interceptions CASCADE;
            TRUNCATE TABLE orazaka_tools_cache CASCADE;
            TRUNCATE TABLE orazaka_tools_rag_source CASCADE;
            TRUNCATE TABLE orazaka_password_resets CASCADE;
            TRUNCATE TABLE orazaka_ai_mcp_servers CASCADE;
            TRUNCATE TABLE orazaka_ai_rag_stores CASCADE;
          `.replace(/\s+/g, " ").trim();

          const dbUser = process.env.SPRING_DATASOURCE_USERNAME ?? "orazaka_admin";
          const dbName = process.env.POSTGRES_DB ?? "orazaka_db";
          execSync(`docker exec -i orazaka-db-vector psql -U ${dbUser} -d ${dbName} -c "${sql}"`, { stdio: "ignore" });
          spinner.stop("Database tables purged.");
        }
      } catch {
        await logWarning("Database purge skipped (container may be stopped).");
      }
    }

    // ─── 3: Process pattern sweep (Unix only) ───────────────
    if (process.platform !== "win32") {
      const patterns = [
        "ollama", "orazaka-worker-media", "orazaka-automation-worker",
        "orazaka-worker-automation", "orazaka-workers/automation",
        "sd-server", "stable-diffusion", "next-dev", "next-server", "orazaka-conversation-service",
      ];

      for (const pattern of patterns) {
        try {
          const pidsStr = execSync(`pgrep -f "${pattern}" || true`).toString().trim();
          if (pidsStr) {
            for (const pidStr of pidsStr.split("\n")) {
              const pid = parseInt(pidStr.trim(), 10);
              if (!isNaN(pid) && pid !== process.pid) {
                try { process.kill(pid, 9); } catch { /* Ignore */ }
              }
            }
          }
        } catch { /* Ignore */ }
      }
    }

    // ─── 4: Docker Compose teardown ─────────────────────────
    const composeFile = resolveComposeFile();
    const dockerComposeCmd = resolveDockerComposeCmd();

    if (fs.existsSync(composeFile) && dockerComposeCmd) {
      spinner.start("Stopping Docker containers...");
      try {
        execSync(`${dockerComposeCmd} -p orazaka -f "${composeFile}" stop`, { stdio: "ignore" });
        if (options.purge) {
          execSync(`${dockerComposeCmd} -p orazaka -f "${composeFile}" down --timeout 5 -v`, { stdio: "ignore" });
          await logSuccess("Docker services and data volumes removed.");
        } else {
          execSync(`${dockerComposeCmd} -p orazaka -f "${composeFile}" down --timeout 5`, { stdio: "ignore" });
          await logSuccess("Docker services stopped (volumes preserved).");
        }
      } catch {
        await logWarning("Docker compose teardown had issues (containers may already be stopped).");
      }
      spinner.stop("Docker teardown complete.");
    }

    // ─── 5: Clean local directories ─────────────────────────
    if (options.purge) {
      spinner.start("Cleaning local directories...");
      const dirsToClean = [
        path.join(workspaceRoot, "var", "orazaka-uploads"),
        path.join(workspaceRoot, "var", "temp"),
      ];

      for (const dir of dirsToClean) {
        if (fs.existsSync(dir)) {
          for (const file of fs.readdirSync(dir)) {
            fs.rmSync(path.join(dir, file), { recursive: true, force: true });
          }
        }
      }

      // Clean PID files
      const varDir = path.join(workspaceRoot, "var");
      if (fs.existsSync(varDir)) {
        for (const file of fs.readdirSync(varDir)) {
          if (file.startsWith(".orazaka") && file.endsWith(".pid")) {
            fs.rmSync(path.join(varDir, file), { force: true });
          }
        }
      }

      spinner.stop("Local directories cleaned.");
    }

    // ─── 6: Memory flush (macOS) ────────────────────────────
    if (process.platform === "darwin") {
      try {
        execSync("purge", { stdio: "ignore" });
      } catch {
        try { execSync("sudo -n purge", { stdio: "ignore" }); } catch { /* Ignore */ }
      }
    }

    // ─── Summary ────────────────────────────────────────────
    console.log("");
    const summaryLines = [
      `${chalk.red("⏹")} Tracked processes terminated`,
      `${chalk.red("⏹")} Docker containers stopped`,
    ];
    if (options.purge) {
      summaryLines.push(`${chalk.red("⏹")} Database data purged`);
      summaryLines.push(`${chalk.red("⏹")} Upload and temp directories cleaned`);
    }
    summaryLines.push(
      "",
      `To restart: ${chalk.cyan("npx orazaka start")}`,
    );

    await note(summaryLines.join("\n"), "Teardown Complete");
    await outro(chalk.red("All services stopped."));
  });
