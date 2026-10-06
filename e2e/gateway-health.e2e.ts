import { describe, it, expect } from "vitest";
import { execa } from "execa";
import * as path from "node:path";

/**
 * Tier 2 — CLI E2E: Gateway Health Validation
 *
 * Validates that the orazaka-cli can reach the active gateway during
 * the hermetic E2E pipeline. Uses direct HTTP to verify the gateway
 * health endpoint is operational before CLI command testing.
 *
 * Environment:
 *   GATEWAY_TARGET_URL — e.g., http://localhost:8080
 *   (Injected by Maven frontend-maven-plugin from .env)
 */

const ROUTER_URL =
  process.env.GATEWAY_TARGET_URL ?? "http://localhost:8080";

describe("Tier 2 — CLI Gateway Integration", () => {
  it("should reach gateway /actuator/health and receive UP status", async () => {
    const response = await fetch(`${ROUTER_URL}/actuator/health`, {
      signal: AbortSignal.timeout(10_000),
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("UP");
  });

  it("should reach gateway /api/v1/models endpoint", async () => {
    const response = await fetch(`${ROUTER_URL}/api/v1/models`, {
      signal: AbortSignal.timeout(10_000),
    });

    // 200 OK or 401 Unauthorized (auth required) — both confirm gateway is alive
    expect([200, 401]).toContain(response.status);
  });

  it("should verify SSE tunnel endpoint exists", async () => {
    const response = await fetch(`${ROUTER_URL}/api/v1/agent/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dispatchId: "e2e-probe", status: "PING" }),
      signal: AbortSignal.timeout(10_000),
    });

    // 200, 401, or 403 all confirm the endpoint is wired
    expect([200, 401, 403]).toContain(response.status);
  });

  it("should successfully log in via CLI command and cache token", async () => {
    const cliPath = path.resolve(__dirname, "../dist/index.js");
    const result = await execa("node", [cliPath, "login", "admin@orazaka.com", "admin"], {
      env: {
        ORAZAKA_HOME: process.env.ORAZAKA_HOME ?? "/tmp",
        GATEWAY_TARGET_URL: ROUTER_URL,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Login successful");
  });
});

