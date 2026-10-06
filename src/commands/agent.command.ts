/**
 * @file agent.command.ts
 * @description Command to start the CLI agent listener, which listens for automation jobs,
 * registers in-memory database ingestion, executes commands offline, and syncs status back.
 */

import { Command } from "commander";
import chalk from "chalk";
import * as http from "node:http";
import * as https from "node:https";
import { exec } from "node:child_process";
import { requireAuth, saveConfig } from "../threads";
import { SettingsApi } from "../services/settings.api";
import { ROUTER_URL } from '../utils/config';
import { createSpinner } from "../ui/prompts";
import {
  insertJob,
  updateJobStatus,
  getUnsyncedJobs,
  markJobSynced,
  getDb,
} from "../services/local-store";

let isReconnecting = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * Sends a job report back to the Gateway.
 */
async function postJobReport(
  jobId: string,
  status: "COMPLETED" | "FAILED",
  logs: string,
  exitCode: number,
  userId: string,
  token: string,
): Promise<boolean> {
  try {
    const url = `${ROUTER_URL}/api/v1/agent/report`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-User-Id": userId,
      },
      body: JSON.stringify({
        jobId,
        status,
        logs,
        exitCode,
      }),
    });

    if (response.ok) {
      markJobSynced(jobId);
      console.log(chalk.green(`✓ Job ${jobId} execution report successfully synced with Router.`));
      return true;
    } else {
      console.warn(
        chalk.yellow(
          `⚠️  Failed to sync report for job ${jobId}. Status: ${response.status}. Retrying later.`,
        ),
      );
      return false;
    }
  } catch {
    console.warn(
      chalk.yellow(
        `⚠️  Network disconnected. Exit code and logs saved locally for job ${jobId}. Will sync on reconnection.`,
      ),
    );
    return false;
  }
}

/**
 * Spawns the task local child-process execution.
 */
function executeLocalJob(
  jobId: string,
  action: string,
  payload: Record<string, unknown>,
  userId: string,
  token: string,
): void {
  console.log(chalk.blue(`🚀 Executing job ${jobId} locally...`));
  updateJobStatus(jobId, "RUNNING", "");

  const command =
    (payload.command as string) ||
    (payload.script as string) ||
    (action ? `${action}` : "");

  if (!command) {
    const errorMsg = "No command or script found in payload";
    updateJobStatus(jobId, "FAILED", errorMsg);
    postJobReport(jobId, "FAILED", errorMsg, -1, userId, token);
    return;
  }

  exec(command, (error, stdout, stderr) => {
    const logs = `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
    const exitCode = error ? (error.code ?? 1) : 0;
    const status = error ? "FAILED" : "COMPLETED";

    console.log(chalk.gray(`Execution completed for job ${jobId} with status ${status}`));

    // Update SQLite state (offline task durability)
    updateJobStatus(jobId, status, logs);

    // Attempt to post report
    postJobReport(jobId, status, logs, exitCode, userId, token);
  });
}

/**
 * Parses and processes a text/event-stream event.
 */
function handleSseEvent(eventStr: string, userId: string, token: string): void {
  const lines = eventStr.split("\n");
  let eventName = "";
  let dataStr = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataStr = line.slice(5).trim();
    }
  }

  if (eventName === "connected") {
    console.log(chalk.gray(`Router connection heartbeat: ${dataStr}`));
  } else if (eventName === "automation_payload") {
    try {
      const data = JSON.parse(dataStr) as {
        jobId: string;
        action: string;
        payload: Record<string, unknown>;
      };

      console.log(
        chalk.cyan(
          `\n📥 Received automation job payload: [Job ID: ${data.jobId}] [Action: ${data.action}]`,
        ),
      );

      // Atomic Ingestion Protocol: Write to local SQLite as PENDING before execution starts
      insertJob(data.jobId, data.payload, "APPROVED");
      console.log(chalk.gray(`Atomic ingestion: Job ${data.jobId} written to local SQLite store.`));

      // Trigger execution
      executeLocalJob(data.jobId, data.action, data.payload, userId, token);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Failed to parse automation payload: ${msg}`));
    }
  }
}

/**
 * Schedules reconnection timer after disconnect.
 */
function scheduleReconnect(userId: string, token: string): void {
  if (isReconnecting) return;
  isReconnecting = true;

  console.log(chalk.yellow("\n🔌 SSE tunnel disconnected. Attempting reconnection in 5 seconds..."));

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    isReconnecting = false;
    listenToAgentStream(userId, token);
  }, 5000);
}

/**
 * Connects to the SSE endpoint and registers listeners.
 */
function listenToAgentStream(userId: string, token: string): void {
  const urlObj = new URL(`${ROUTER_URL}/api/v1/agent/stream`);
  const options = {
    method: "GET",
    headers: {
      "X-User-Id": userId,
      "Authorization": `Bearer ${token}`,
      "Accept": "text/event-stream",
    },
  };

  const client = urlObj.protocol === "https:" ? https : http;

  const req = client.request(urlObj, options, (res) => {
    if (res.statusCode !== 200) {
      console.error(chalk.red(`\n❌ SSE connection failed with status: ${res.statusCode}`));
      scheduleReconnect(userId, token);
      return;
    }

    console.log(chalk.green(`\n✓ SSE stream established with Router. Local Agent is online.`));

    // Force run-once sync on successful connection
    const unsynced = getUnsyncedJobs();
    if (unsynced.length > 0) {
      console.log(chalk.cyan(`\nFound ${unsynced.length} unsynced local job(s) from disconnected state.`));
      for (const job of unsynced) {
        if (job.status === "COMPLETED" || job.status === "FAILED") {
          const exitCode = job.status === "COMPLETED" ? 0 : 1;
          postJobReport(job.jobId, job.status, job.executionLogs, exitCode, userId, token);
        }
      }
    }

    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        handleSseEvent(part, userId, token);
      }
    });

    res.on("end", () => {
      console.warn(chalk.yellow("\n⚠️  SSE stream ended."));
      scheduleReconnect(userId, token);
    });

    res.on("error", (err) => {
      console.error(chalk.red(`\n❌ SSE stream error: ${err.message}`));
      scheduleReconnect(userId, token);
    });
  });

  req.on("error", (err) => {
    console.error(chalk.red(`\n❌ SSE request failed: ${err.message}`));
    scheduleReconnect(userId, token);
  });

  req.end();
}

/**
 * Registers a heartbeat timer to periodically sync unsynced jobs.
 */
function startHeartbeatSync(userId: string, token: string): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    const unsynced = getUnsyncedJobs();
    if (unsynced.length > 0) {
      for (const job of unsynced) {
        if (job.status === "COMPLETED" || job.status === "FAILED") {
          const exitCode = job.status === "COMPLETED" ? 0 : 1;
          await postJobReport(job.jobId, job.status, job.executionLogs, exitCode, userId, token);
        }
      }
    }
  }, 15000);
}

export const agentCommand = new Command("agent")
  .description("Manage Orazaka local executing agent")
  .addCommand(
    new Command("listen")
      .description("Start CLI agent listener and reverse tunnel")
      .action(async () => {
        const config = requireAuth();
        let userId = config.userId;

        if (!userId) {
          const s = await createSpinner();
          s.start("Fetching user profile ID to configure CLI Agent...");
          try {
            const me = await SettingsApi.getMe();
            userId = me.id;
            saveConfig({
              ...config,
              userId,
            });
            s.stop("User ID retrieved and configured.");
          } catch (err: unknown) {
            s.stop("Failed to retrieve user ID", 1);
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`Error: ${msg}`));
            process.exit(1);
          }
        }

        // Initialize local SQLite table
        getDb();

        console.log(chalk.cyan("🥷 Starting Orazaka Local Agent Listener..."));
        console.log(chalk.gray(`Gateway: ${ROUTER_URL}`));
        console.log(chalk.gray(`User ID: ${userId}`));

        // Connect and start polling heartbeat sync
        listenToAgentStream(userId, config.token);
        startHeartbeatSync(userId, config.token);

        // Keep process alive
        process.on("SIGINT", () => {
          console.log(chalk.yellow("\nStopping Agent Listener..."));
          if (reconnectTimer) clearTimeout(reconnectTimer);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          process.exit(0);
        });
      }),
  );
