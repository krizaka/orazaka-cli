/**
 * @file logs-steps.test.ts
 * @description Guards the pure steps extracted from `orazaka logs` (behaviour unchanged by the refactor).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendedLines,
  filterByService,
  formatAge,
  formatFileSize,
  getServiceLabel,
  lastLines,
  parseSinceMs,
  readRange,
} from "../commands/logs.steps";

describe("parseSinceMs", () => {
  it("reads minutes, hours and days", () => {
    expect(parseSinceMs("30m")).toBe(30 * 60 * 1000);
    expect(parseSinceMs("2h")).toBe(2 * 60 * 60 * 1000);
    expect(parseSinceMs("3d")).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("falls back to 24 hours when absent or malformed", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(parseSinceMs(undefined)).toBe(day);
    expect(parseSinceMs("")).toBe(day);
    expect(parseSinceMs("soon")).toBe(day);
    expect(parseSinceMs("5w")).toBe(day);
  });
});

describe("filterByService", () => {
  const files = ["router.log", "ollama.log", "Media-Worker.log"];

  it("keeps every file without a service", () => {
    expect(filterByService(files, undefined)).toEqual(files);
  });

  it("matches the service name case-insensitively", () => {
    expect(filterByService(files, "MEDIA")).toEqual(["Media-Worker.log"]);
    expect(filterByService(files, "nothing")).toEqual([]);
  });
});

describe("labels, sizes and ages", () => {
  it("labels a file by its service, the legacy names included", () => {
    expect(getServiceLabel("gateway.log")).toBe("ROUTER ");
    expect(getServiceLabel("ollama.log")).toBe("OLLAMA ");
    expect(getServiceLabel("video-worker.log")).toBe("MEDIA  ");
    expect(getServiceLabel("image-worker.log")).toBe("IMAGE  ");
    expect(getServiceLabel("ui.log")).toBe("UI     ");
    expect(getServiceLabel("other.log")).toBe("LOG    ");
  });

  it("formats sizes in B, KB and MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("formats an age in minutes under an hour and in hours after", () => {
    const now = 10_000_000;
    expect(formatAge(now - 5 * 60 * 1000, now)).toBe("5m ago");
    expect(formatAge(now - 59 * 60 * 1000, now)).toBe("59m ago");
    expect(formatAge(now - 3 * 60 * 60 * 1000, now)).toBe("3h ago");
  });
});

describe("text steps", () => {
  it("keeps the last non-empty lines", () => {
    expect(lastLines("a\n\nb\nc\n", 2)).toEqual(["b", "c"]);
    expect(lastLines("", 5)).toEqual([]);
  });

  it("drops blank lines from appended text", () => {
    expect(appendedLines("one\n  \ntwo\n")).toEqual(["one", "two"]);
  });

  it("reads a byte range of a file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-logs-"));
    const file = path.join(dir, "router.log");
    fs.writeFileSync(file, "first\nsecond\nthird\n");
    expect(readRange(file, 6, 12)).toBe("second");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
