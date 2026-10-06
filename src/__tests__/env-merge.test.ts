/**
 * @file env-merge.test.ts
 * @description Guards the non-destructive .env contract used by `orazaka install`
 * and `orazaka init`: existing developer values are never overwritten — only
 * missing keys are appended.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mergeEnvFile, parseEnvFile } from "../utils/platform";

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
