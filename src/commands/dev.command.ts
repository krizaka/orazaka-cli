/**
 * @file dev.command.ts
 * @description Parallel development orchestrator for the Orazaka full-stack.
 * Spawns the Router (Spring Boot) backend, Web Client, Web Admin, and Mobile
 * Expo servers with color-coded prefixed output and premium DevX logging.
 *
 * This is the *application* layer of the dev loop. The *infrastructure* layer
 * (Docker middleware + native AI engines) is started separately by
 * `orazaka start --mode dev`. Run that first, then `orazaka dev`.
 */

import { Command } from "commander";
import { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { logWarning } from "../ui/prompts";
import { spawnWithPrefix } from "../utils/process";
import { PORTS } from "../utils/config";
import { resolveWorkspaceFrom } from "../utils/platform";

/** Stable service identifiers used by the `--only` filter. */
export type ServiceKey =
  | "edge"
  | "router"
  | "identity"
  | "automation"
  | "knowledge"
  | "job"
  | "billing"
  | "studio"
  | "notifications"
  | "web"
  | "admin"
  | "mobile"
  | "workers";

const SERVICE_KEYS: readonly ServiceKey[] = [
  "edge",
  "router",
  "identity",
  "automation",
  "knowledge",
  "job",
  "billing",
  "studio",
  "notifications",
  "web",
  "admin",
  "mobile",
  "workers",
];

/** Back-compat aliases for `--only` tokens (old name → canonical key). */
const SERVICE_ALIASES: Record<string, ServiceKey> = { core: "router" };

/**
 * Every worker this repository ships, discovered from its own declaration.
 *
 * <b>Nothing started a pack's worker before this.</b> `orazaka dev` launched eight JVM services and
 * two UIs and no Python at all; the media worker was started only by the e2e harness, and the
 * document-validation pack's by nobody. A user who installed that pack got a run that stayed
 * RUNNING forever — and its first job command was discarded by the broker, because no queue was
 * bound when it was published (docs/evaluations/first-real-use.md, B3).
 *
 * The launcher does not know how to start a worker: each `worker.yaml` says so under `run:`. The
 * two in this repository already start differently — one as a module, one as a script beside a venv
 * one directory up — so a launcher carrying that knowledge would carry it for the workers that
 * existed when it was written, and a pack shipped from outside this repository has nobody to ask
 * (AGENTS.md §12).
 */
function discoverWorkers(root: string, enabled: boolean): ProcessConfig[] {
  const found: ProcessConfig[] = [];
  const skip = new Set(["node_modules", ".git", "target", ".venv", "dist", "__pycache__"]);

  const walk = (dir: string, depth: number): void => {
    if (depth > 5) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !skip.has(entry.name)) {
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name === "worker.yaml") {
        const declared = readWorkerRun(path.join(dir, entry.name));
        if (declared) {
          found.push({
            serviceKey: "workers",
            label: declared.label,
            color: chalk.magenta,
            command: declared.python,
            args: declared.args,
            cwd: dir,
            enabled,
          });
        }
      }
    }
  };
  walk(root, 0);
  return found;
}

/**
 * The `run:` block of one worker.yaml, or null when it declares none.
 *
 * Parsed with a reader narrow enough to need no dependency: `name`, and a `run:` mapping with a
 * `python` string and an `args` inline list. A worker that declares no `run:` is not started and
 * says nothing — the same fail-closed direction as every other declaration in this repository.
 */
function readWorkerRun(
  file: string,
): { label: string; python: string; args: string[] } | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const body = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const name = /^name:\s*(\S+)/m.exec(body);
  const python = /^\s+python:\s*"([^"]+)"/m.exec(body);
  const args = /^\s+args:\s*\[([^\]]*)\]/m.exec(body);
  if (!python || !args) return null;
  const parsed = args[1]
    .split(",")
    .map((a) => a.trim().replace(/^["']|["']$/g, ""))
    .filter((a) => a.length > 0);
  return {
    label: (name ? name[1] : path.basename(path.dirname(file))).toUpperCase(),
    python: python[1],
    args: parsed,
  };
}

/** Label configuration for each spawned process. */
interface ProcessConfig {
  serviceKey: ServiceKey;
  label: string;
  color: (text: string) => string;
  command: string;
  args: string[];
  cwd: string;
  enabled: boolean;
  port?: number;
}

/**
 * Resolves the workspace root (orazaka.workspace.json) by walking up from the CLI.
 */
function resolveMonorepoRoot(): string {
  return resolveWorkspaceFrom(__dirname);
}

/**
 * Parses the `--only` value into a validated set of service keys. Accepts a
 * comma-separated list (e.g. "web,mobile"); unknown tokens are rejected so a
 * typo never silently launches nothing.
 */
function parseOnly(raw: string | undefined): Set<ServiceKey> {
  const selected = new Set<ServiceKey>();
  if (!raw) return selected;
  for (const token of raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    const canonical = SERVICE_ALIASES[token] ?? token;
    if ((SERVICE_KEYS as readonly string[]).includes(canonical)) {
      selected.add(canonical as ServiceKey);
    } else {
      logWarning(`Unknown --only service "${token}" (expected: ${SERVICE_KEYS.join(", ")}).`);
    }
  }
  return selected;
}

/** Options accepted by `orazaka dev` (skip flags + `--only` filter). */
export interface DevOptions {
  only?: string;
  skipEdge?: boolean;
  skipRouter?: boolean;
  skipIdentity?: boolean;
  /** @deprecated alias for `skipRouter` */
  skipCore?: boolean;
  skipAutomation?: boolean;
  skipKnowledge?: boolean;
  skipJob?: boolean;
  skipBilling?: boolean;
  skipStudio?: boolean;
  skipNotifications?: boolean;
  skipAdmin?: boolean;
  skipMobile?: boolean;
  skipWeb?: boolean;
  skipWorkers?: boolean;
}

/**
 * Pure resolver for which services the dev stack should launch. Extracted so the
 * skip/only precedence is unit-testable without spawning real processes.
 *
 * Precedence: `--only` (allow-list) wins; otherwise each `--skip-*` flag removes
 * its service. `--skip-router` accepts the legacy `--skip-core` spelling.
 */
export function resolveEnabledServices(opts: DevOptions): Record<ServiceKey, boolean> {
  const only = parseOnly(opts.only);
  const skip: Record<ServiceKey, boolean> = {
    edge: Boolean(opts.skipEdge),
    router: Boolean(opts.skipRouter ?? opts.skipCore),
    identity: Boolean(opts.skipIdentity),
    automation: Boolean(opts.skipAutomation),
    knowledge: Boolean(opts.skipKnowledge),
    job: Boolean(opts.skipJob),
    billing: Boolean(opts.skipBilling),
    studio: Boolean(opts.skipStudio),
    notifications: Boolean(opts.skipNotifications),
    web: Boolean(opts.skipWeb),
    admin: Boolean(opts.skipAdmin),
    mobile: Boolean(opts.skipMobile),
    workers: Boolean(opts.skipWorkers),
  };
  const enabled = {} as Record<ServiceKey, boolean>;
  for (const key of SERVICE_KEYS) {
    enabled[key] = only.size > 0 ? only.has(key) : !skip[key];
  }
  return enabled;
}

export const devCommand = new Command("dev")
  .description("Launch the full Orazaka application stack in parallel (9 services + Web, Admin, Mobile)")
  .option(
    "--only <services>",
    "Launch only these services (comma-separated: edge,router,identity,automation,knowledge,job,billing,studio,notifications,web,admin,mobile)",
  )
  .option("--skip-edge", "Skip the Edge gateway (strangler facade on :8088)")
  .option("--skip-identity", "Skip the Identity service (:8083)")
  .option("--skip-router", "Skip the Router (Spring Boot) backend — run RouterApplication from your IDE instead")
  .option("--skip-core", "Deprecated alias for --skip-router")
  .option("--skip-automation", "Skip the Automation service (AMQP on :8082)")
  .option("--skip-knowledge", "Skip the Knowledge service (:8084)")
  .option("--skip-job", "Skip the Job Orchestration service (:8090)")
  .option("--skip-billing", "Skip the Billing service (:8095)")
  .option("--skip-studio", "Skip the Studio service (:8096)")
  .option("--skip-notifications", "Skip the Notification service (:8097)")
  .option("--skip-admin", "Skip Admin console")
  .option("--skip-mobile", "Skip Expo mobile server")
  .option("--skip-web", "Skip Web client")
  .option("--skip-workers", "Skip the Python workers declared by worker.yaml")
  .action((opts: DevOptions) => {
    const root = resolveMonorepoRoot();
    const uiRoot = path.join(root, "orazaka-apps", "ui");

    const enabled = resolveEnabledServices(opts);
    const isEnabled = (key: ServiceKey): boolean => enabled[key];

    const processes: ProcessConfig[] = [
      {
        serviceKey: "edge",
        label: "EDGE",
        color: chalk.blue,
        command: "./mvnw",
        args: ["spring-boot:run", "-pl", "orazaka-apps/services/orazaka-edge"],
        cwd: root,
        enabled: isEnabled("edge"),
        port: PORTS.edge,
      },
      {
        serviceKey: "router",
        label: "ROUTER",
        color: chalk.green,
        command: "./mvnw",
        args: [
          "spring-boot:run",
          "-pl", "orazaka-apps/services/orazaka-conversation-service",
          "-Dspring-boot.run.profiles=e2e",
        ],
        cwd: root,
        enabled: isEnabled("router"),
        port: PORTS.router,
      },
      {
        serviceKey: "identity",
        label: "IDENTITY",
        color: chalk.white,
        command: "./mvnw",
        args: ["spring-boot:run", "-pl", "krizaka/krizaka-users/krizaka-users-service"],
        cwd: root,
        enabled: isEnabled("identity"),
        port: PORTS.identity,
      },
      {
        serviceKey: "automation",
        label: "AUTOMATION",
        color: chalk.gray,
        command: "./mvnw",
        args: ["spring-boot:run", "-pl", "orazaka-apps/services/orazaka-automation-service"],
        cwd: root,
        enabled: isEnabled("automation"),
        port: PORTS.automationWorker,
      },
      {
        serviceKey: "knowledge",
        label: "KNOWLEDGE",
        color: chalk.magenta,
        command: "./mvnw",
        args: ["spring-boot:run", "-pl", "orazaka-apps/services/orazaka-knowledge-service"],
        cwd: root,
        enabled: isEnabled("knowledge"),
        port: PORTS.knowledge,
      },
      {
        serviceKey: "job",
        label: "JOB",
        color: chalk.gray,
        command: "./mvnw",
        args: ["spring-boot:run", "-pl", "orazaka-apps/services/orazaka-job-service"],
        cwd: root,
        enabled: isEnabled("job"),
        port: PORTS.jobService,
      },
      {
        serviceKey: "billing",
        label: "BILLING",
        color: chalk.green,
        command: "./mvnw",
        args: ["spring-boot:run", "-pl", "orazaka-apps/services/orazaka-billing/orazaka-billing-service"],
        cwd: root,
        enabled: isEnabled("billing"),
        port: PORTS.billing,
      },
      {
        serviceKey: "studio",
        label: "STUDIO",
        color: chalk.yellow,
        command: "./mvnw",
        args: ["spring-boot:run", "-pl", "orazaka-apps/services/orazaka-studio/orazaka-studio-service"],
        cwd: root,
        enabled: isEnabled("studio"),
        port: PORTS.studio,
      },
      {
        serviceKey: "notifications",
        label: "NOTIFICATIONS",
        color: chalk.blue,
        command: "./mvnw",
        args: [
          "spring-boot:run",
          "-pl",
          "orazaka-apps/services/orazaka-notifications/orazaka-notification-service",
        ],
        cwd: root,
        enabled: isEnabled("notifications"),
        port: PORTS.notifications,
      },
      {
        serviceKey: "web",
        label: "WEB-CLIENT",
        color: chalk.cyan,
        command: "npm",
        args: ["run", "dev", "--", "--port", String(PORTS.web)],
        cwd: path.join(uiRoot, "orazaka-web-client"),
        enabled: isEnabled("web"),
        port: PORTS.web,
      },
      {
        serviceKey: "admin",
        label: "WEB-ADMIN",
        color: chalk.magenta,
        command: "npm",
        args: ["run", "dev"],
        cwd: path.join(uiRoot, "orazaka-web-admin"),
        enabled: isEnabled("admin"),
        port: PORTS.admin,
      },
      {
        serviceKey: "mobile",
        label: "MOBILE",
        color: chalk.yellow,
        command: "npx",
        args: ["expo", "start"],
        cwd: path.join(uiRoot, "orazaka-mobile-client"),
        enabled: isEnabled("mobile"),
        port: PORTS.mobile,
      },
    ];

    // Workers are appended rather than listed: each declares its own `run:` in worker.yaml, so a
    // pack that ships one is started without editing this file (AGENTS.md §12).
    processes.push(...discoverWorkers(root, isEnabled("workers")));

    const activeConfigs = processes.filter((p) => p.enabled);
    const skippedConfigs = processes.filter((p) => !p.enabled);

    if (activeConfigs.length === 0) {
      logWarning("All processes skipped — nothing to launch.");
      return;
    }

    // ─── Startup Banner ──────────────────────────────────────
    const BOX_W = 54; // inner width between │ chars

    const pad = (text: string, width: number): string =>
      text + " ".repeat(Math.max(0, width - text.length));

    console.log("");
    console.log(chalk.cyan.bold("  ┌" + "─".repeat(BOX_W) + "┐"));
    console.log(chalk.cyan.bold("  │") + chalk.white.bold(pad("  🥷  Orazaka Dev Stack", BOX_W)) + chalk.cyan.bold("│"));
    console.log(chalk.cyan.bold("  ├" + "─".repeat(BOX_W) + "┤"));

    for (const cfg of activeConfigs) {
      const row = `  ● ${cfg.label.padEnd(14)}:${cfg.port}  http://localhost:${cfg.port}`;
      console.log(
        chalk.cyan("  │") +
        `  ${cfg.color("●")} ${cfg.color(cfg.label.padEnd(14))}` +
        chalk.white(`:${cfg.port}`) +
        chalk.dim(`  http://localhost:${cfg.port}`) +
        " ".repeat(Math.max(0, BOX_W - row.length)) +
        chalk.cyan("│"),
      );
    }

    if (skippedConfigs.length > 0) {
      const dashContent = "  " + Array.from({ length: Math.floor((BOX_W - 4) / 2) }, () => "─ ").join("").trimEnd();
      console.log(chalk.cyan("  │") + chalk.dim(pad(dashContent, BOX_W)) + chalk.cyan("│"));
      for (const cfg of skippedConfigs) {
        const row = `  ○ ${cfg.label.padEnd(14)}skipped`;
        console.log(
          chalk.cyan("  │") +
          `  ${chalk.dim("○")} ${chalk.dim(cfg.label.padEnd(14))}` +
          chalk.dim("skipped") +
          " ".repeat(Math.max(0, BOX_W - row.length)) +
          chalk.cyan("│"),
        );
      }
    }

    console.log(chalk.cyan.bold("  └" + "─".repeat(BOX_W) + "┘"));
    console.log("");
    console.log(chalk.dim("  Press Ctrl+C to stop all processes"));
    console.log("");

    // ─── Spawn Processes ─────────────────────────────────────
    const children: ChildProcess[] = [];

    for (const cfg of activeConfigs) {
      children.push(spawnWithPrefix(cfg));
    }

    // ─── Graceful Shutdown (guard against double-fire) ───────
    let shuttingDown = false;

    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log("");
      console.log(chalk.yellow.bold("  ⏹  Shutting down…"));
      console.log("");

      for (const child of children) {
        child.kill("SIGTERM");
      }

      // Force kill after 5 seconds
      setTimeout(() => {
        for (const child of children) {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }
        process.exit(0);
      }, 5000);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
