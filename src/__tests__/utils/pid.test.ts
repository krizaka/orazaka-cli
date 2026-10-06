/**
 * @file pid.test.ts
 * @description Verifies the shared PID-file helpers (read/append/liveness) used
 * by start/status/stop.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readPidFile, appendPid, isPidAlive } from "../../utils/pid";

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-pid-"));
  return path.join(dir, ".orazaka.pid");
}

describe("readPidFile", () => {
  test("parses name=pid lines, skipping comments and blanks", () => {
    const f = tmpFile();
    fs.writeFileSync(f, "# header\nollama=1234\n\nrouter=5678\nbad-line\n", "utf-8");
    const map = readPidFile(f);
    expect(map.get("ollama")).toBe(1234);
    expect(map.get("router")).toBe(5678);
    expect(map.size).toBe(2);
  });

  test("returns an empty map when the file is missing", () => {
    expect(readPidFile(path.join(os.tmpdir(), "nope-orazaka.pid")).size).toBe(0);
  });
});

describe("appendPid", () => {
  test("appends an entry and is round-trippable via readPidFile", () => {
    const f = tmpFile();
    appendPid(f, "media-worker", 4321);
    expect(readPidFile(f).get("media-worker")).toBe(4321);
  });

  test("is a no-op when the pid is undefined", () => {
    const f = tmpFile();
    appendPid(f, "ghost", undefined);
    expect(fs.existsSync(f)).toBe(false);
  });
});

describe("isPidAlive", () => {
  test("true for the current process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test("false for an almost-certainly-dead PID", () => {
    expect(isPidAlive(2_147_483_646)).toBe(false);
  });
});
