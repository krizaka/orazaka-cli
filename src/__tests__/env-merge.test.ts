/**
 * @file env-merge.test.ts
 * @description Guards the non-destructive .env contract used by `orazaka install`
 * and `orazaka init`: existing developer values are never overwritten — only
 * missing keys are appended.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureDbRolePasswords, mergeEnvFile, parseEnvFile } from "../utils/platform";

function tmpEnv(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

describe("mergeEnvFile (non-destructive .env)", () => {
  test("never overwrites an existing key, only appends missing ones", () => {
    const file = tmpEnv("OLLAMA_BASE_URL=http://host.docker.internal:11434\nPORT=8080\n");

    const added = mergeEnvFile(file, {
      OLLAMA_BASE_URL: "http://localhost:11434", // already set — must be kept
      DEFAULT_PROVIDER: "ollama", // missing — must be added
    });

    const result = parseEnvFile(file);
    expect(result.OLLAMA_BASE_URL).toBe("http://host.docker.internal:11434");
    expect(result.PORT).toBe("8080");
    expect(result.DEFAULT_PROVIDER).toBe("ollama");
    expect(added).toEqual(["DEFAULT_PROVIDER"]);
  });

  test("returns no additions when every key already exists", () => {
    const file = tmpEnv("A=1\nB=2\n");
    const added = mergeEnvFile(file, { A: "999", B: "999" });
    expect(added).toEqual([]);
    const result = parseEnvFile(file);
    expect(result).toMatchObject({ A: "1", B: "2" });
  });
});

describe("ensureDbRolePasswords (a fresh install leaves no role without a strong password)", () => {
  const KEYS = ["IDENTITY", "KNOWLEDGE", "AUTOMATION", "BILLING", "STUDIO"].map((c) => `${c}_DB_PASSWORD`);
  let n = 0;
  const gen = () => `generated-${String(++n)}-`.padEnd(40, "x");

  test("fills the keys that are missing, blank or still CHANGE_ME — and keeps what the developer set", () => {
    const file = tmpEnv("BILLING_DB_PASSWORD=CHANGE_ME\nSTUDIO_DB_PASSWORD=mine-keep\nKNOWLEDGE_DB_PASSWORD=\nPORT=8080\n");
    const keys = ensureDbRolePasswords(file, gen);
    const env = parseEnvFile(file);
    expect(keys.sort()).toEqual(["AUTOMATION_DB_PASSWORD", "BILLING_DB_PASSWORD", "IDENTITY_DB_PASSWORD", "KNOWLEDGE_DB_PASSWORD"]);
    expect(env.STUDIO_DB_PASSWORD).toBe("mine-keep");
    expect(env.PORT).toBe("8080");
    for (const k of KEYS) expect(env[k]).toBeTruthy();
    for (const k of KEYS) expect(env[k]).not.toMatch(/CHANGE_?ME/i);
    expect(new Set(KEYS.map((k) => env[k])).size).toBe(KEYS.length);
  });

  test("stores the file owner-only (0600) and is idempotent", () => {
    const file = tmpEnv("PORT=1\n");
    ensureDbRolePasswords(file, gen);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const before = fs.readFileSync(file, "utf-8");
    expect(ensureDbRolePasswords(file, gen)).toEqual([]);
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });

  test("returns key names only, never a value", () => {
    const file = tmpEnv("");
    const out = ensureDbRolePasswords(file, () => "SECRET-VALUE");
    expect(JSON.stringify(out)).not.toContain("SECRET-VALUE");
  });
});
