/**
 * @file dev-command.test.ts
 * @description Proves the `orazaka dev` skip/only precedence so a flag never
 * silently launches (or skips) the wrong service — the exact class of bug
 * reported for `--skip-router` (ex `--skip-core`) and `--skip-mobile`.
 */

import { absoluteUploadDir, bannerAddress, bannerLabelWidth, resolveEnabledServices, type ServiceKey } from "../commands/dev.command";

const ALL: ServiceKey[] = ["router", "web", "mobile"];

describe("resolveEnabledServices", () => {
  test("no flags → every service enabled", () => {
    const enabled = resolveEnabledServices({});
    for (const k of ALL) expect(enabled[k]).toBe(true);
  });

  test("--skip-router disables the Router (Spring Boot) backend only", () => {
    const enabled = resolveEnabledServices({ skipRouter: true });
    expect(enabled.router).toBe(false);
    expect(enabled.web).toBe(true);
    expect(enabled.mobile).toBe(true);
  });

  test("--skip-core remains a working alias for --skip-router", () => {
    expect(resolveEnabledServices({ skipCore: true }).router).toBe(false);
  });

  test("--skip-mobile actually disables mobile", () => {
    const enabled = resolveEnabledServices({ skipMobile: true });
    expect(enabled.mobile).toBe(false);
    expect(enabled.router).toBe(true);
  });

  test("the original `start:dev` combo (skip router + mobile) leaves web", () => {
    const enabled = resolveEnabledServices({ skipRouter: true, skipMobile: true });
    expect(enabled).toEqual({
      edge: true,
      router: false,
      identity: true,
      automation: true,
      knowledge: true,
      job: true,
      billing: true,
      studio: true,
      notifications: true,
      web: true,
      mobile: false,
      // The Python workers declared by worker.yaml. Nothing started them before ADR-072 §4 — a
      // pack that shipped one got a run that stayed RUNNING forever — so `dev` grew a tier and
      // this assertion pins it like every other.
      workers: true,
    });
  });

  test("--only is an allow-list that overrides skip flags", () => {
    const enabled = resolveEnabledServices({ only: "web,admin", skipWeb: true });
    expect(enabled).toEqual({
      edge: false,
      router: false,
      identity: false,
      automation: false,
      knowledge: false,
      job: false,
      billing: false,
      studio: false,
      notifications: false,
      web: true,
      mobile: false,
      // `--only web,admin` is an allow-list, so every other tier is off — workers included.
      workers: false,
    });
  });

  test("--only accepts the legacy `core` token as `router`", () => {
    const enabled = resolveEnabledServices({ only: "core" });
    expect(enabled.router).toBe(true);
    expect(enabled.web).toBe(false);
  });
});

describe("absoluteUploadDir", () => {
  test("a relative UPLOAD_DIR is resolved against the workspace, not a service's module", () => {
    expect(absoluteUploadDir("/ws", "var/orazaka-uploads")).toBe("/ws/var/orazaka-uploads");
  });

  test("an absolute UPLOAD_DIR is kept", () => {
    expect(absoluteUploadDir("/ws", "/data/uploads")).toBe("/data/uploads");
  });

  test("an absent or blank UPLOAD_DIR falls back to the workspace's var/orazaka-uploads", () => {
    expect(absoluteUploadDir("/ws", undefined)).toBe("/ws/var/orazaka-uploads");
    expect(absoluteUploadDir("/ws", "  ")).toBe("/ws/var/orazaka-uploads");
  });
});

describe("dev banner", () => {
  test("a service shows its port and URL; a worker says it has no HTTP port", () => {
    expect(bannerAddress(8088)).toBe(":8088  http://localhost:8088");
    expect(bannerAddress(undefined)).toBe("queue worker — no HTTP port");
  });

  test("the name column fits the longest name (a worker's), never less than 14", () => {
    expect(bannerLabelWidth([{ label: "EDGE" }])).toBe(14);
    expect(bannerLabelWidth([{ label: "EDGE" }, { label: "ORAZAKA-WORKER-VALIDATION" }])).toBe(26);
  });
});
