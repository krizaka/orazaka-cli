/**
 * @file local-store.test.ts
 * @description Tests for local-store — SQLite-based offline job persistence.
 */

import * as path from "node:path";
import * as fs from "node:fs";

const mockTempDir = path.join(__dirname, "temp-test-db-dir");
if (!fs.existsSync(mockTempDir)) {
  fs.mkdirSync(mockTempDir, { recursive: true });
}

// Mock node:os homedir to point to mockTempDir. Must be hoisted and prefix with mock.
jest.mock("node:os", () => {
  const actual = jest.requireActual("node:os");
  return {
    ...actual,
    homedir: () => mockTempDir,
  };
});

import {
  getDb,
  closeDb,
  insertJob,
  updateJobStatus,
  getUnsyncedJobs,
  markJobSynced,
} from "../../services/local-store";

describe("local-store persistence engine", () => {
  beforeEach(() => {
    // Recreate clean database table before each test
    const db = getDb();
    db.exec("DELETE FROM orazaka_local_jobs");
  });

  afterAll(() => {
    closeDb();
    const dbFile = path.join(mockTempDir, ".orazaka-tasks.db");
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
    }
    // Clean up WAL/SHM files created by better-sqlite3
    const walFile = `${dbFile}-wal`;
    const shmFile = `${dbFile}-shm`;
    if (fs.existsSync(walFile)) {
      fs.unlinkSync(walFile);
    }
    if (fs.existsSync(shmFile)) {
      fs.unlinkSync(shmFile);
    }
    if (fs.existsSync(mockTempDir)) {
      fs.rmSync(mockTempDir, { recursive: true, force: true });
    }
  });

  test("getDb initializes and returns better-sqlite3 Database instance", () => {
    const db = getDb();
    expect(db).toBeDefined();

    // Verify schema table existence
    const stmt = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='orazaka_local_jobs'",
    );
    const row = stmt.get() as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.name).toBe("orazaka_local_jobs");
  });

  test("getDb returns same instance on subsequent calls", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  test("insertJob inserts pending job, and ON CONFLICT updates it", () => {
    const jobId = "job-uuid-1";
    const payload = { command: "npm run test", env: "test" };

    insertJob(jobId, payload, "APPROVED");

    const unsynced = getUnsyncedJobs();
    // PENDING status jobs are not returned by getUnsyncedJobs (which returns only COMPLETED/FAILED)
    expect(unsynced.length).toBe(0);

    const db = getDb();
    const stmt = db.prepare(
      "SELECT * FROM orazaka_local_jobs WHERE job_id = ?",
    );
    const row = stmt.get(jobId) as
      | {
          job_id: string;
          command_payload: string;
          status: string;
          retry_count: number;
          user_approval_state: string;
          execution_logs: string;
          synced: number;
        }
      | undefined;

    expect(row).toBeDefined();
    expect(row?.job_id).toBe(jobId);
    expect(JSON.parse(row!.command_payload)).toEqual(payload);
    expect(row?.status).toBe("PENDING");
    expect(row?.synced).toBe(0);

    // Test conflict update
    const updatedPayload = { command: "npm run dev" };
    insertJob(jobId, updatedPayload, "DENIED");

    const row2 = stmt.get(jobId) as {
      command_payload: string;
      user_approval_state: string;
    };
    expect(JSON.parse(row2.command_payload)).toEqual(updatedPayload);
    expect(row2.user_approval_state).toBe("DENIED");
  });

  test("insertJob uses default approval state when not provided", () => {
    const jobId = "job-default-approval";
    insertJob(jobId, { cmd: "test" });

    const db = getDb();
    const stmt = db.prepare(
      "SELECT user_approval_state FROM orazaka_local_jobs WHERE job_id = ?",
    );
    const row = stmt.get(jobId) as { user_approval_state: string };
    expect(row.user_approval_state).toBe("APPROVED");
  });

  test("updateJobStatus changes status and logs under different optional parameters", () => {
    const jobId = "job-uuid-2";
    insertJob(jobId, { run: "yes" });

    // Test update status only
    updateJobStatus(jobId, "RUNNING", "Started running...");
    const db = getDb();
    const stmt = db.prepare(
      "SELECT status, execution_logs, retry_count, synced FROM orazaka_local_jobs WHERE job_id = ?",
    );

    let row = stmt.get(jobId) as {
      status: string;
      execution_logs: string;
      retry_count: number;
      synced: number;
    };
    expect(row.status).toBe("RUNNING");
    expect(row.execution_logs).toBe("Started running...");
    expect(row.retry_count).toBe(0);
    expect(row.synced).toBe(0);

    // Test update with retryCount only
    updateJobStatus(jobId, "FAILED", "Error occurred", 2);
    row = stmt.get(jobId) as {
      status: string;
      execution_logs: string;
      retry_count: number;
      synced: number;
    };
    expect(row.status).toBe("FAILED");
    expect(row.execution_logs).toBe("Error occurred");
    expect(row.retry_count).toBe(2);
    expect(row.synced).toBe(0);

    // Test update with synced only
    updateJobStatus(jobId, "COMPLETED", "Success", undefined, 1);
    row = stmt.get(jobId) as {
      status: string;
      execution_logs: string;
      retry_count: number;
      synced: number;
    };
    expect(row.status).toBe("COMPLETED");
    expect(row.execution_logs).toBe("Success");
    expect(row.retry_count).toBe(2);
    expect(row.synced).toBe(1);

    // Test update with both retryCount and synced
    updateJobStatus(jobId, "FAILED", "Another error", 3, 0);
    row = stmt.get(jobId) as {
      status: string;
      execution_logs: string;
      retry_count: number;
      synced: number;
    };
    expect(row.status).toBe("FAILED");
    expect(row.execution_logs).toBe("Another error");
    expect(row.retry_count).toBe(3);
    expect(row.synced).toBe(0);
  });

  test("getUnsyncedJobs filters by unsynced completed/failed tasks", () => {
    insertJob("j-pending", { cmd: "pending" });
    insertJob("j-completed-unsynced", { cmd: "completed-unsynced" });
    insertJob("j-failed-unsynced", { cmd: "failed-unsynced" });
    insertJob("j-completed-synced", { cmd: "completed-synced" });

    updateJobStatus("j-completed-unsynced", "COMPLETED", "log-success", 0, 0);
    updateJobStatus("j-failed-unsynced", "FAILED", "log-fail", 1, 0);
    updateJobStatus("j-completed-synced", "COMPLETED", "log-synced", 0, 1);

    const unsynced = getUnsyncedJobs();
    expect(unsynced.length).toBe(2);

    const unsyncedIds = unsynced.map((j) => j.jobId);
    expect(unsyncedIds).toContain("j-completed-unsynced");
    expect(unsyncedIds).toContain("j-failed-unsynced");
    expect(unsyncedIds).not.toContain("j-pending");
    expect(unsyncedIds).not.toContain("j-completed-synced");

    const completedJob = unsynced.find(
      (j) => j.jobId === "j-completed-unsynced",
    );
    expect(completedJob?.status).toBe("COMPLETED");
    expect(completedJob?.executionLogs).toBe("log-success");
    expect(completedJob?.retryCount).toBe(0);
    expect(completedJob?.synced).toBe(0);
  });

  test("getUnsyncedJobs returns empty array when no unsynced jobs exist", () => {
    const unsynced = getUnsyncedJobs();
    expect(unsynced).toEqual([]);
  });

  test("markJobSynced marks job as synced", () => {
    const jobId = "j-sync-test";
    insertJob(jobId, { cmd: "sync" });
    updateJobStatus(jobId, "COMPLETED", "done", 0, 0);

    expect(getUnsyncedJobs().length).toBe(1);

    markJobSynced(jobId);

    expect(getUnsyncedJobs().length).toBe(0);
  });

  test("closeDb properly closes the database and resets instance", () => {
    getDb(); // Ensure initialized
    closeDb();
    // After close, next getDb() should create a new instance
    const newDb = getDb();
    expect(newDb).toBeDefined();
  });
});
