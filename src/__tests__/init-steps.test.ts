/**
 * @file init-steps.test.ts
 * @description Guards the pure steps extracted from `orazaka init` (behaviour unchanged by the refactor).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildSystemLines,
  createMissingDirs,
  findEnvTemplate,
  injectGeneratedValues,
  renderEnvFile,
  secureHex,
} from "../commands/init.steps";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-init-"));

describe("renderEnvFile", () => {
  it("writes the header, the timestamp and one KEY=VALUE per default", () => {
    const text = renderEnvFile({ PORT: "8080", APP_NAME: "Orazaka" }, new Date("2026-10-29T10:00:00.000Z"));
    const lines = text.split("\n");
    expect(lines[1]).toBe("# ORAZAKA ENVIRONMENT CONFIGURATION");
    expect(lines[3]).toBe("# Timestamp: 2026-10-29T10:00:00.000Z");
    expect(lines.slice(-2)).toEqual(["PORT=8080", "APP_NAME=Orazaka"]);
  });
});

describe("injectGeneratedValues", () => {
  it("gives the three generated keys fresh hex values of the right length and keeps the others", () => {
    const out = injectGeneratedValues(
      ["SPRING_DATASOURCE_PASSWORD=changeme", "CRYPTO_KEY=x", "CRYPTO_SALT=y", "PORT=8080"].join("\n"),
    );
    const read = (key: string): string => new RegExp(`${key}=(.*)`).exec(out)![1]!;
    expect(read("SPRING_DATASOURCE_PASSWORD")).toMatch(/^[0-9a-f]{32}$/);
    expect(read("CRYPTO_KEY")).toMatch(/^[0-9a-f]{32}$/);
    expect(read("CRYPTO_SALT")).toMatch(/^[0-9a-f]{16}$/);
    expect(read("PORT")).toBe("8080");
  });

  it("draws different values each time", () => {
    expect(secureHex(16)).not.toBe(secureHex(16));
  });
});

describe("findEnvTemplate", () => {
  it("returns the first template that exists, in the documented order", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, ".env.template"), "T=1");
    fs.writeFileSync(path.join(dir, ".env.example"), "E=1");
    expect(findEnvTemplate(dir)).toEqual({ name: ".env.example", content: "E=1" });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined without a template", () => {
    const dir = tmp();
    expect(findEnvTemplate(dir)).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("buildSystemLines", () => {
  const sys = {
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Apple M2",
    totalMemoryGb: 16,
    nodeVersion: "v22.0.0",
    isAppleSilicon: true,
  } as Parameters<typeof buildSystemLines>[0];

  it("adds the accelerator on Apple Silicon and the tools when there are some", () => {
    const text = buildSystemLines(sys, "/ws", ["Node v22"]).join("\n");
    expect(text).toContain("Apple Silicon Metal MPS");
    expect(text).toContain("Node v22");
  });

  it("omits both otherwise", () => {
    const text = buildSystemLines({ ...sys, isAppleSilicon: false }, "/ws", []).join("\n");
    expect(text).not.toContain("Accelerator");
    expect(text).not.toContain("Tools");
  });
});

describe("createMissingDirs", () => {
  it("creates only what is missing and says how many", () => {
    const root = tmp();
    const existing = path.join(root, "a");
    const missing = path.join(root, "b");
    fs.mkdirSync(existing);
    const created = createMissingDirs([existing, missing], (dir) => fs.mkdirSync(dir));
    expect(created).toBe(1);
    expect(fs.existsSync(missing)).toBe(true);
    expect(createMissingDirs([existing, missing], (dir) => fs.mkdirSync(dir))).toBe(0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
