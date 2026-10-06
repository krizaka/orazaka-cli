/**
 * @file threads-module.test.ts
 * @description Tests for threads.ts module functions using fs mocks.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Mock fs for isolated config/thread testing ───────────────────────────────

jest.mock("fs");
jest.mock("os");

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

// Set up mock homedir before importing threads
mockOs.homedir.mockReturnValue("/mock/home");

// Now import the module under test
import {
  loadConfig,
  saveConfig,
  listThreads,
  loadMessages,
  appendMessage,
  updateThreadTitle,
  requireAuth,
  createThread,
  switchThread,
} from "../threads";

beforeEach(() => {
  jest.clearAllMocks();
  mockOs.homedir.mockReturnValue("/mock/home");
});

describe("loadConfig", () => {
  test("returns null when config file does not exist", () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = loadConfig();
    expect(result).toBeNull();
  });

  test("returns parsed config when file is valid", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        token: "jwt-abc",
        username: "alice",
        activeThreadId: "t1",
        threads: [{ conversationId: "t1", title: "Test", updatedAt: 1000 }],
      }),
    );

    const result = loadConfig();
    expect(result).not.toBeNull();
    expect(result!.token).toBe("jwt-abc");
    expect(result!.username).toBe("alice");
    expect(result!.threads).toHaveLength(1);
  });

  test("returns null for malformed JSON", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("not json");

    const result = loadConfig();
    expect(result).toBeNull();
  });

  test("returns null when required fields are missing", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ foo: "bar" }));

    const result = loadConfig();
    expect(result).toBeNull();
  });

  test("generates activeThreadId when missing from config", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ token: "t", username: "u", threads: [] }),
    );

    const result = loadConfig();
    expect(result).not.toBeNull();
    expect(result!.activeThreadId).toBeTruthy();
  });

  test("defaults threads to empty array when not an array", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ token: "t", username: "u", activeThreadId: "x", threads: "bad" }),
    );

    const result = loadConfig();
    expect(result).not.toBeNull();
    expect(result!.threads).toEqual([]);
  });
});

describe("saveConfig", () => {
  test("writes config JSON to disk", () => {
    const config = {
      token: "jwt",
      username: "bob",
      activeThreadId: "t2",
      threads: [],
    };

    saveConfig(config);

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      path.join("/mock/home", ".orazaka-cli.json"),
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  });
});

describe("listThreads", () => {
  test("returns threads from config", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        token: "t",
        username: "u",
        activeThreadId: "t1",
        threads: [{ conversationId: "t1", title: "One", updatedAt: 1 }],
      }),
    );

    const threads = listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe("One");
  });

  test("returns empty array when no config", () => {
    mockFs.existsSync.mockReturnValue(false);

    const threads = listThreads();
    expect(threads).toEqual([]);
  });
});

describe("loadMessages", () => {
  test("returns empty array when file does not exist", () => {
    mockFs.existsSync.mockReturnValue(false);

    const msgs = loadMessages("thread-123");
    expect(msgs).toEqual([]);
  });

  test("returns parsed messages from file", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify([
        { role: "user", content: "hi", kind: "text", timestamp: 1000 },
      ]),
    );

    const msgs = loadMessages("thread-123");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("hi");
  });

  test("returns empty array on parse error", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("corrupted");

    const msgs = loadMessages("thread-err");
    expect(msgs).toEqual([]);
  });
});

describe("appendMessage", () => {
  test("creates directory and appends message", () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue("[]");

    const msg = { role: "user" as const, content: "test", kind: "text" as const, timestamp: Date.now() };
    appendMessage("thread-1", msg);

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      path.join("/mock/home", ".orazaka-threads"),
      { recursive: true },
    );
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });
});

describe("updateThreadTitle", () => {
  test("updates title in config and leaves other threads untouched", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        token: "t",
        username: "u",
        activeThreadId: "t1",
        threads: [
          { conversationId: "t1", title: "Old", updatedAt: 1 },
          { conversationId: "t2", title: "Untouched", updatedAt: 2 },
        ],
      }),
    );

    updateThreadTitle("t1", "New Title");

    expect(mockFs.writeFileSync).toHaveBeenCalled();
    const written = JSON.parse(
      (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string,
    );
    expect(written.threads[0].title).toBe("New Title");
    expect(written.threads[1].title).toBe("Untouched");
  });

  test("no-op when config is null", () => {
    mockFs.existsSync.mockReturnValue(false);

    updateThreadTitle("nonexistent", "Title");

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("requireAuth", () => {
  let mockExit: jest.SpyInstance;
  let mockConsoleError: jest.SpyInstance;

  beforeEach(() => {
    mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  test("returns config when token exists", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        token: "valid-jwt",
        username: "admin",
        activeThreadId: "t1",
        threads: [],
      }),
    );

    const config = requireAuth();
    expect(config.token).toBe("valid-jwt");
  });

  test("exits when no config exists", () => {
    mockFs.existsSync.mockReturnValue(false);

    expect(() => requireAuth()).toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test("exits when token is empty", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        token: "",
        username: "u",
        activeThreadId: "t1",
        threads: [],
      }),
    );

    expect(() => requireAuth()).toThrow("process.exit called");
  });
});

describe("createThread", () => {
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  test("creates a new thread with custom title", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        token: "jwt",
        username: "u",
        activeThreadId: "old",
        threads: [],
      }),
    );

    const thread = createThread("My Thread");

    expect(thread.title).toBe("My Thread");
    expect(thread.conversationId).toBeTruthy();
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  test("creates a new thread with default title", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        token: "jwt",
        username: "u",
        activeThreadId: "old",
        threads: [],
      }),
    );

    const thread = createThread();

    expect(thread.title).toBe("New Memory Block");
  });
});

describe("switchThread", () => {
  let mockExit: jest.SpyInstance;
  let mockConsoleError: jest.SpyInstance;

  beforeEach(() => {
    mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  test("switches to an existing thread", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        token: "jwt",
        username: "u",
        activeThreadId: "t1",
        threads: [{ conversationId: "t1", title: "One", updatedAt: 1 }],
      }),
    );

    switchThread("t1");

    expect(mockFs.writeFileSync).toHaveBeenCalled();
    const written = JSON.parse(
      (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string,
    );
    expect(written.activeThreadId).toBe("t1");
  });

  test("exits when thread does not exist", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        token: "jwt",
        username: "u",
        activeThreadId: "t1",
        threads: [{ conversationId: "t1", title: "One", updatedAt: 1 }],
      }),
    );

    expect(() => switchThread("nonexistent")).toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
