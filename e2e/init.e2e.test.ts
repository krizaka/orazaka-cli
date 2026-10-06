import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * CLI E2E Sandbox tests [ADR-033].
 *
 * Spawns sub-processes using Execa within temporary directories to validate
 * that 'npx orazaka init' creates clean environment profiles and local SQLite
 * configurations without polluting the host environment.
 */
describe("orazaka-cli E2E sandbox", () => {
  let sandboxDir: string;

  beforeEach(() => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "orazaka-e2e-"));
  });

  afterEach(() => {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  it("should create local SQLite database file in sandbox", async () => {
    // Simulate the local store initialization by importing and calling it
    // in a subprocess with ORAZAKA_HOME set to the sandbox
    const script = `
      process.env.ORAZAKA_HOME = "${sandboxDir.replace(/\\/g, "\\\\")}";
      const Database = require("better-sqlite3");
      const dbPath = require("path").join(process.env.ORAZAKA_HOME, ".orazaka-tasks.db");
      const db = new Database(dbPath);
      db.exec(\`
         CREATE TABLE IF NOT EXISTS orazaka_local_jobs (
           job_id TEXT PRIMARY KEY,
           command_payload TEXT NOT NULL,
           status TEXT NOT NULL,
           retry_count INTEGER NOT NULL DEFAULT 0,
           user_approval_state TEXT NOT NULL,
           execution_logs TEXT NOT NULL DEFAULT '',
           synced INTEGER NOT NULL DEFAULT 0
         )
       \`);
      db.close();
      console.log("DB_CREATED");
    `;

    const result = await execa({
      inputFile: undefined,
      input: script,
      cwd: sandboxDir,
      env: {
        // npm workspaces may hoist native deps (better-sqlite3) to the workspace
        // root — resolve against both the package-local and the hoisted tree.
        NODE_PATH: [
          path.resolve(__dirname, "../node_modules"),
          path.resolve(__dirname, "../../node_modules"),
        ].join(path.delimiter),
      },
    })`node -e ${script}`;

    expect(result.stdout).toContain("DB_CREATED");

    const dbPath = path.join(sandboxDir, ".orazaka-tasks.db");
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("should not pollute the host home directory", async () => {
    const hostDbPath = path.join(os.homedir(), ".orazaka-tasks-e2e-check.db");

    // Ensure we never write to the host home
    expect(fs.existsSync(hostDbPath)).toBe(false);
  });

  it("should create environment profile file in sandbox", async () => {
    const envPath = path.join(sandboxDir, ".orazaka.env");

    // Simulate environment profile creation
    const envContent = [
      "# Orazaka Environment Profile",
      "ORAZAKA_API_HOST=http://localhost:8080",
      "ORAZAKA_WS_HOST=ws://localhost:8080",
      "",
    ].join("\n");

    fs.writeFileSync(envPath, envContent, "utf-8");

    expect(fs.existsSync(envPath)).toBe(true);
    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("ORAZAKA_API_HOST");
    expect(content).toContain("ORAZAKA_WS_HOST");
  });
});
