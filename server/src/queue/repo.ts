import { randomUUID } from "node:crypto";
import type { DB } from "../db/client.js";
import type { JobInput, JobResult, JobRow, JobStatus, JobType } from "./types.js";

interface DbRow {
  id: string;
  type: JobType;
  status: JobStatus;
  input_json: string;
  result_json: string | null;
  error_text: string | null;
  session_id: string | null;
  attempts: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
}

function rowToJob(r: DbRow): JobRow {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    input: JSON.parse(r.input_json) as JobInput,
    result: r.result_json ? (JSON.parse(r.result_json) as JobResult) : null,
    errorText: r.error_text,
    sessionId: r.session_id,
    attempts: r.attempts,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
  };
}

export class JobRepo {
  constructor(private db: DB) {}

  enqueue(type: JobType, input: JobInput): { id: string } {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO jobs (id, type, status, input_json, attempts, created_at)
         VALUES (?, ?, 'queued', ?, 0, ?)`,
      )
      .run(id, type, JSON.stringify(input), now);
    return { id };
  }

  /**
   * Atomically claim the next queued job. Marks it 'running' and bumps attempts.
   * Returns null if the queue is empty.
   */
  claimNext(): JobRow | null {
    const now = Date.now();
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM jobs
           WHERE status = 'queued'
           ORDER BY created_at ASC
           LIMIT 1`,
        )
        .get() as DbRow | undefined;
      if (!row) return null;
      this.db
        .prepare(
          `UPDATE jobs
           SET status = 'running', started_at = ?, attempts = attempts + 1
           WHERE id = ?`,
        )
        .run(now, row.id);
      const updated = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(row.id) as DbRow;
      return updated;
    });
    const claimed = tx();
    return claimed ? rowToJob(claimed) : null;
  }

  markSucceeded(id: string, result: JobResult, sessionId: string | null): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE jobs
         SET status = 'succeeded',
             result_json = ?,
             session_id = ?,
             finished_at = ?,
             duration_ms = ? - COALESCE(started_at, ?)
         WHERE id = ?`,
      )
      .run(JSON.stringify(result), sessionId, now, now, now, id);
  }

  markFailed(id: string, errorText: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE jobs
         SET status = 'failed',
             error_text = ?,
             finished_at = ?,
             duration_ms = ? - COALESCE(started_at, ?)
         WHERE id = ?`,
      )
      .run(errorText, now, now, now, id);
  }

  getById(id: string): JobRow | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as DbRow | undefined;
    return row ? rowToJob(row) : null;
  }

  /**
   * Sweep on startup: any job left 'running' from a previous process is orphaned.
   * Mark them failed. Bound by jobTimeoutMs * 2 so we don't kill a job that's
   * legitimately still in flight in another process (shouldn't happen with our
   * single-worker model, but defense in depth).
   */
  sweepOrphaned(jobTimeoutMs: number): number {
    const cutoff = Date.now() - jobTimeoutMs * 2;
    const result = this.db
      .prepare(
        `UPDATE jobs
         SET status = 'failed',
             error_text = 'orphaned: process exited mid-job',
             finished_at = ?
         WHERE status = 'running' AND COALESCE(started_at, 0) < ?`,
      )
      .run(Date.now(), cutoff);
    return result.changes;
  }

  listRecent(limit: number): JobRow[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as DbRow[];
    return rows.map(rowToJob);
  }
}
