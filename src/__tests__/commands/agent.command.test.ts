/**
 * @file agent.command.test.ts
 * @description Tests for Orazaka Agent Command listener, execution, and sync heartbeats.
 */

import { agentCommand } from "../../commands/agent.command";
import * as http from "node:http";
import { exec } from "node:child_process";
import { requireAuth } from "../../threads";
import { SettingsApi } from "../../services/settings.api";
import {
  insertJob,
  updateJobStatus,
  getUnsyncedJobs,
  markJobSynced,
} from "../../services/local-store";

jest.mock("../../threads", () => ({
  requireAuth: jest.fn(),
  saveConfig: jest.fn(),
}));

jest.mock("../../services/settings.api", () => ({
  SettingsApi: {
    getMe: jest.fn(),
  },
}));

jest.mock("../../services/local-store", () => ({
  insertJob: jest.fn(),
  updateJobStatus: jest.fn(),
  getUnsyncedJobs: jest.fn(),
  markJobSynced: jest.fn(),
  getDb: jest.fn(),
}));

jest.mock("node:child_process", () => ({
  exec: jest.fn(),
}));

jest.mock("node:http", () => ({
  request: jest.fn(),
}));

jest.mock("node:https", () => ({
  request: jest.fn(),
}));

jest.mock("../../ui/prompts", () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  logStep: jest.fn(),
  logSuccess: jest.fn(),
  logWarning: jest.fn(),
  logInfo: jest.fn(),
  logError: jest.fn(),
  note: jest.fn(),
  createSpinner: jest.fn().mockResolvedValue({ start: jest.fn(), stop: jest.fn() }),
  handleCancel: jest.fn(),
}));

describe("agent command listen", () => {
  let mockHttpRequest: jest.Mock;
  let mockFetch: jest.Mock;
  let exitSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockHttpRequest = http.request as jest.Mock;
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    exitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // Default mock behaviors
    (requireAuth as jest.Mock).mockReturnValue({ token: "test-token", userId: "user-123" });
    (getUnsyncedJobs as jest.Mock).mockReturnValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test("listen command action starts successfully and retrieves userId if missing", async () => {
    (requireAuth as jest.Mock).mockReturnValue({ token: "test-token", userId: undefined });
    (SettingsApi.getMe as jest.Mock).mockResolvedValue({ id: "user-456" });

    // Mock http.request to return dummy request object
    const dummyReq = { on: jest.fn(), end: jest.fn() };
    mockHttpRequest.mockReturnValue(dummyReq);

    await agentCommand.parseAsync(["node", "orazaka", "listen"]);

    expect(SettingsApi.getMe).toHaveBeenCalled();
    expect(mockHttpRequest).toHaveBeenCalled();
  });

  test("listen command registers SSE stream, executes job, and reports state", async () => {
    let dataListener: ((chunk: string) => void) | undefined;
    
    // Mock SSE response object
    const mockResponse = {
      statusCode: 200,
      setEncoding: jest.fn(),
      on: jest.fn((event, listener) => {
        if (event === "data") {
          dataListener = listener;
        }
      }),
    };

    const dummyReq = { on: jest.fn(), end: jest.fn() };
    mockHttpRequest.mockImplementation((url, options, cb) => {
      cb(mockResponse);
      return dummyReq;
    });

    // Mock Child Process execution
    const mockExec = exec as unknown as jest.Mock;
    mockExec.mockImplementation((cmd, cb) => {
      // simulate command execution
      cb(null, "output text", "error text");
      return {};
    });

    // Mock fetch response for reporting
    mockFetch.mockResolvedValue({ ok: true });

    await agentCommand.parseAsync(["node", "orazaka", "listen"]);

    expect(mockHttpRequest).toHaveBeenCalled();
    expect(dataListener).toBeDefined();

    // Send mock SSE event
    const sseEvent = "event: automation_payload\ndata: " + JSON.stringify({
      jobId: "job-abc",
      action: "test-command",
      payload: { command: "echo 'hello'" },
    }) + "\n\n";

    if (dataListener) {
      dataListener(sseEvent);
    }

    // Expect atomic ingestion write to SQLite
    expect(insertJob).toHaveBeenCalledWith("job-abc", { command: "echo 'hello'" }, "APPROVED");
    
    // Expect state change to RUNNING
    expect(updateJobStatus).toHaveBeenCalledWith("job-abc", "RUNNING", "");

    // Expect execution and status completion update
    expect(exec).toHaveBeenCalledWith("echo 'hello'", expect.any(Function));
    expect(updateJobStatus).toHaveBeenCalledWith("job-abc", "COMPLETED", expect.stringContaining("output text"));

    // Expect gateway sync report posting
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/agent/report"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          jobId: "job-abc",
          status: "COMPLETED",
          logs: "STDOUT:\noutput text\nSTDERR:\nerror text",
          exitCode: 0,
        }),
      }),
    );

    // Wait for async report callback
    await jest.runOnlyPendingTimersAsync();
    expect(markJobSynced).toHaveBeenCalledWith("job-abc");
  });

  test("listen command handles failed offline job execution and updates to FAILED", async () => {
    let dataListener: ((chunk: string) => void) | undefined;
    
    const mockResponse = {
      statusCode: 200,
      setEncoding: jest.fn(),
      on: jest.fn((event, listener) => {
        if (event === "data") dataListener = listener;
      }),
    };

    const dummyReq = { on: jest.fn(), end: jest.fn() };
    mockHttpRequest.mockImplementation((url, options, cb) => {
      cb(mockResponse);
      return dummyReq;
    });

    // Mock Child Process execution failure
    const mockExec = exec as unknown as jest.Mock;
    mockExec.mockImplementation((cmd, cb) => {
      cb({ code: 127 }, "", "command not found");
      return {};
    });

    mockFetch.mockResolvedValue({ ok: true });

    await agentCommand.parseAsync(["node", "orazaka", "listen"]);

    // Trigger payload
    const sseEvent = "event: automation_payload\ndata: " + JSON.stringify({
      jobId: "job-fail",
      action: "invalid-command",
      payload: { command: "invalid-command" },
    }) + "\n\n";

    if (dataListener) {
      dataListener(sseEvent);
    }

    expect(updateJobStatus).toHaveBeenCalledWith("job-fail", "FAILED", expect.stringContaining("command not found"));
    
    // Wait for reporting
    await jest.runOnlyPendingTimersAsync();
    expect(markJobSynced).toHaveBeenCalledWith("job-fail");
  });

  test("syncs previously unsynced jobs upon connection and periodic heartbeat", async () => {
    const dummyReq = { on: jest.fn(), end: jest.fn() };
    mockHttpRequest.mockImplementation((url, options, cb) => {
      cb({
        statusCode: 200,
        setEncoding: jest.fn(),
        on: jest.fn(),
      });
      return dummyReq;
    });

    // Mock fetch
    mockFetch.mockResolvedValue({ ok: true });

    // Mock two unsynced jobs: one COMPLETED and one FAILED
    const mockUnsynced = [
      { jobId: "unsynced-1", status: "COMPLETED", executionLogs: "success log" },
      { jobId: "unsynced-2", status: "FAILED", executionLogs: "fail log" },
    ];
    (getUnsyncedJobs as jest.Mock).mockReturnValue(mockUnsynced);

    await agentCommand.parseAsync(["node", "orazaka", "listen"]);

    // Verify sync triggered immediately upon connection
    expect(getUnsyncedJobs).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Fast-forward periodic heartbeat sync (15 seconds)
    jest.advanceTimersByTime(15000);
    expect(getUnsyncedJobs).toHaveBeenCalledTimes(2);
  });
});
