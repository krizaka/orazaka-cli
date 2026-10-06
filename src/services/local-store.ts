/**
 * @file local-store.ts
 * @description Local persistent transaction engine for agent offline resilience.
 * Coordinates SQLite-based storage of task payloads, execution states, and logs.
 * Uses better-sqlite3 for cross-environment compatibility (Jest, ts-jest, Node 18+).
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as path from "node:path";
import * as os from "node:os";

export interface LocalJob {
  readonly jobId: string;
  readonly commandPayload: string;
  readonly status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  readonly retryCount: number;
  readonly userApprovalState: string;
  readonly executionLogs: string;
  readonly synced: number;
}

const DB_PATH = path.join(os.homedir(), ".orazaka-tasks.db");

let dbInstance: DatabaseType | null = null;

/**
 * Returns the active Database instance. Initializes it if not yet open.
 */
export function getDb(): DatabaseType {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS orazaka_local_jobs (
        job_id TEXT PRIMARY KEY,
        command_payload TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        user_approval_state TEXT NOT NULL,
        execution_logs TEXT NOT NULL DEFAULT '',
        synced INTEGER NOT NULL DEFAULT 0
      )
    `);
  }
  return dbInstance;
}

/**
 * Closes the local database connection. Useful for clean tests.
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Inserts a new job instruction into the local SQLite store as PENDING.
 * Atomic ingestion protocol: write before execute.
 */
export function insertJob(
  jobId: string,
  payload: Record<string, unknown>,
  approvalState: string = "APPROVED",
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO orazaka_local_jobs (job_id, command_payload, status, retry_count, user_approval_state, execution_logs, synced)
    VALUES (?, ?, 'PENDING', 0, ?, '', 0)
    ON CONFLICT(job_id) DO UPDATE SET
      command_payload = excluded.command_payload,
      status = 'PENDING',
      user_approval_state = excluded.user_approval_state,
      synced = 0
  `);
  stmt.run(jobId, JSON.stringify(payload), approvalState);
}

/**
 * Updates the execution status, logs, and optionally retry count/sync state.
 */
export function updateJobStatus(
  jobId: string,
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED",
  logs: string,
  retryCount?: number,
  synced?: number,
): void {
  const db = getDb();
  if (retryCount !== undefined && synced !== undefined) {
    const stmt = db.prepare(`
      UPDATE orazaka_local_jobs
      SET status = ?, execution_logs = ?, retry_count = ?, synced = ?
      WHERE job_id = ?
    `);
    stmt.run(status, logs, retryCount, synced, jobId);
  } else if (retryCount !== undefined) {
    const stmt = db.prepare(`
      UPDATE orazaka_local_jobs
      SET status = ?, execution_logs = ?, retry_count = ?
      WHERE job_id = ?
    `);
    stmt.run(status, logs, retryCount, jobId);
  } else if (synced !== undefined) {
    const stmt = db.prepare(`
      UPDATE orazaka_local_jobs
      SET status = ?, execution_logs = ?, synced = ?
      WHERE job_id = ?
    `);
    stmt.run(status, logs, synced, jobId);
  } else {
    const stmt = db.prepare(`
      UPDATE orazaka_local_jobs
      SET status = ?, execution_logs = ?
      WHERE job_id = ?
    `);
    stmt.run(status, logs, jobId);
  }
}

/**
 * Retrieves all jobs currently in COMPLETED or FAILED state that have not been synced yet.
 */
export function getUnsyncedJobs(): LocalJob[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT 
      job_id AS jobId, 
      command_payload AS commandPayload, 
      status, 
      retry_count AS retryCount, 
      user_approval_state AS userApprovalState, 
      execution_logs AS executionLogs, 
      synced
    FROM orazaka_local_jobs
    WHERE synced = 0 AND (status = 'COMPLETED' OR status = 'FAILED')
  `);
  const rows = stmt.all() as Array<{
    jobId: string;
    commandPayload: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    retryCount: number;
    userApprovalState: string;
    executionLogs: string;
    synced: number;
  }>;
  return rows.map((raw) => ({
    jobId: raw.jobId,
    commandPayload: raw.commandPayload,
    status: raw.status,
    retryCount: Number(raw.retryCount),
    userApprovalState: raw.userApprovalState,
    executionLogs: raw.executionLogs,
    synced: Number(raw.synced),
  }));
}

/**
 * Marks a job as synced with the Gateway.
 */
export function markJobSynced(jobId: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE orazaka_local_jobs
    SET synced = 1
    WHERE job_id = ?
  `);
  stmt.run(jobId);
}
