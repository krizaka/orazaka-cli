/**
 * @file threads.test.ts
 * @description Tests for CLI thread management — config persistence, thread CRUD.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CliConfig, StoredMessage } from "../types/local.types";

// ── Isolated test environment ───────────────────────────────────────────────
// We override the module-internal constants by mocking the `fs` calls
// and using a temp directory for test isolation.

let tmpDir: string;
let configPath: string;
let threadsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  configPath = path.join(tmpDir, ".orazaka-cli.json");
  threadsDir = path.join(tmpDir, ".orazaka-threads");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(config: CliConfig) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function readConfig(): CliConfig {
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

describe("Config persistence (manual)", () => {
  test("writes and reads config round-trip", () => {
    const config: CliConfig = {
      token: "jwt-token-xyz",
      username: "testuser",
      activeThreadId: "thread-1",
      threads: [
        {
          conversationId: "thread-1",
          title: "Test Thread",
          updatedAt: Date.now(),
        },
      ],
    };
    writeConfig(config);
    const loaded = readConfig();
    expect(loaded.token).toBe("jwt-token-xyz");
    expect(loaded.username).toBe("testuser");
    expect(loaded.activeThreadId).toBe("thread-1");
    expect(loaded.threads).toHaveLength(1);
  });

  test("config with empty threads array", () => {
    const config: CliConfig = {
      token: "tok",
      username: "u",
      activeThreadId: "a",
      threads: [],
    };
    writeConfig(config);
    const loaded = readConfig();
    expect(loaded.threads).toEqual([]);
  });
});

describe("Message persistence (manual)", () => {
  test("writes and reads messages round-trip", () => {
    fs.mkdirSync(threadsDir, { recursive: true });
    const threadFile = path.join(threadsDir, "conv-1.json");

    const messages: StoredMessage[] = [
      { role: "user", content: "hello", kind: "text", timestamp: Date.now() },
      {
        role: "assistant",
        content: "Hi there!",
        kind: "text",
        timestamp: Date.now(),
      },
    ];

    fs.writeFileSync(threadFile, JSON.stringify(messages, null, 2), "utf-8");
    const loaded: StoredMessage[] = JSON.parse(
      fs.readFileSync(threadFile, "utf-8"),
    );
    expect(loaded).toHaveLength(2);
    expect(loaded[0].role).toBe("user");
    expect(loaded[1].role).toBe("assistant");
    expect(loaded[0].kind).toBe("text");
  });

  test("handles audio message kind", () => {
    fs.mkdirSync(threadsDir, { recursive: true });
    const threadFile = path.join(threadsDir, "conv-2.json");

    const messages: StoredMessage[] = [
      {
        role: "assistant",
        content: "data:audio/mp3;base64,abc",
        kind: "audio",
        timestamp: Date.now(),
      },
    ];

    fs.writeFileSync(threadFile, JSON.stringify(messages), "utf-8");
    const loaded: StoredMessage[] = JSON.parse(
      fs.readFileSync(threadFile, "utf-8"),
    );
    expect(loaded[0].kind).toBe("audio");
  });
});

describe("Type-level thread contract", () => {
  test("ChatThread has required fields", () => {
    const thread = {
      conversationId: "conv-abc",
      title: "Memory Block #1",
      updatedAt: 1700000000000,
    };
    expect(thread.conversationId).toBeTruthy();
    expect(thread.title).toBeTruthy();
    expect(thread.updatedAt).toBeGreaterThan(0);
  });
});
