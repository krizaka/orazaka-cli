/**
 * @file config.ts
 * @description Single source of truth for runtime configuration. Loads the
 * workspace-root `.env` exactly once (on first import) and exposes typed,
 * env-driven accessors. No port, host or URL is hardcoded anywhere else in the
 * CLI — every command/service reads from here so values stay in sync with `.env`.
 *
 * Each value falls back to a documented default only when the key is absent from
 * `.env`; when present, the `.env` value wins.
 */

import * as path from "node:path";
import { resolveWorkspaceRootSmart, parseEnvFile } from "./platform";

// Load .env from the workspace root into process.env — the single source of
// truth. We use the in-house parser (utils/platform) rather than `dotenv` so
// this module — which sits on the import path of nearly every command — never
// hard-crashes with MODULE_NOT_FOUND if an external dep is mid-install/hoist.
// Existing process.env values win (matching dotenv's non-override semantics).
for (const [key, value] of Object.entries(parseEnvFile(path.join(resolveWorkspaceRootSmart(), ".env")))) {
  if (process.env[key] === undefined) process.env[key] = value;
}

/** Reads an integer env var, falling back through alternative keys then a default. */
export function intEnv(keys: string | readonly string[], fallback: number): number {
  for (const key of typeof keys === "string" ? [keys] : keys) {
    const raw = process.env[key];
    if (raw && raw.trim()) {
      const n = parseInt(raw.trim(), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

/** Reads a string env var, falling back through alternative keys then a default. */
export function strEnv(keys: string | readonly string[], fallback: string): string {
  for (const key of typeof keys === "string" ? [keys] : keys) {
    const raw = process.env[key];
    if (raw && raw.trim()) return raw.trim();
  }
  return fallback;
}

/**
 * Service ports, env-driven. The fallback mirrors `infra/docker-compose.yml`
 * (middleware) and the app conventions (Router 8080, Web 3000, …).
 */
export const PORTS = {
  edge: intEnv("EDGE_PORT", 8088),
  identity: intEnv("IDENTITY_PORT", 8083),
  router: intEnv("PORT", 8080),
  web: intEnv("WEB_PORT", 3000),
  admin: intEnv("ADMIN_PORT", 3001),
  mobile: intEnv("MOBILE_PORT", 8081),
  ollama: intEnv("OLLAMA_PORT", 11434),
  localai: intEnv(["LOCALAI_PORT", "IMAGE_WORKER_PORT"], 8085),
  imageGen: intEnv("IMAGE_GEN_PORT", 8086),
  mediaWorker: intEnv(["MEDIA_WORKER_PORT", "VIDEO_WORKER_PORT"], 8188),
  automationWorker: intEnv("AUTOMATION_WORKER_PORT", 8082),
  knowledge: intEnv("KNOWLEDGE_PORT", 8084),
  jobService: intEnv("JOB_SERVICE_PORT", 8090),
  billing: intEnv("BILLING_PORT", 8095),
  studio: intEnv("STUDIO_PORT", 8096),
  notifications: intEnv("NOTIFICATIONS_PORT", 8097),
  postgres: intEnv("POSTGRES_PORT", 5432),
  redis: intEnv("REDIS_PORT", 6379),
  // Canonical first, legacy second — the compatibility read kept for one version
  // while a `.env` written before the names were settled still works (ADR-053 §8).
  rabbitmq: intEnv(["RABBITMQ_PORT", "SPRING_RABBITMQ_PORT"], 5672),
  rabbitmqMgmt: intEnv("RABBITMQ_MGMT_PORT", 15672),
} as const;

/** Every host port the CLI touches — used by teardown/port-sweeps. */
export const ALL_PORTS: readonly number[] = [
  PORTS.web, PORTS.admin, PORTS.router, PORTS.edge, PORTS.identity, PORTS.knowledge,
  PORTS.jobService, PORTS.billing, PORTS.studio, PORTS.automationWorker, PORTS.localai,
  PORTS.imageGen, PORTS.mediaWorker, PORTS.ollama, PORTS.postgres, PORTS.redis,
  PORTS.rabbitmq, PORTS.rabbitmqMgmt,
];

/**
 * Base URL for the Orazaka Router (REST, GraphQL, SSE). Reads `ROUTER_URL`,
 * falling back to the legacy `GATEWAY_URL` during the rename transition.
 */
export const ROUTER_URL: string = strEnv(["ROUTER_URL", "GATEWAY_URL"], `http://localhost:${String(PORTS.router)}`);

/** Default Ollama model, env-driven. */
export const OLLAMA_MODEL: string = strEnv("OLLAMA_MODEL", "phi3:mini");

/**
 * CLI health/probe timing, env-driven (`CLI_*` keys). Centralized so retry and
 * timeout budgets are tuned from `.env` rather than scattered magic numbers.
 */
export const TIMEOUTS = {
  /** Default retry budget when waiting for a service to come up. */
  healthRetries: intEnv("CLI_HEALTH_RETRIES", 30),
  /** Delay between health retries (ms). */
  healthIntervalMs: intEnv("CLI_HEALTH_INTERVAL_MS", 1000),
  /** HTTP probe timeout (ms). */
  httpTimeoutMs: intEnv("CLI_HTTP_TIMEOUT_MS", 3000),
  /** TCP port-probe socket timeout (ms). */
  portProbeMs: intEnv("CLI_PORT_PROBE_MS", 300),
} as const;
