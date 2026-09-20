import { sql } from 'drizzle-orm';
import { newId, type RunQueue, type RunQueueJob } from '@sheetpilot/core';
import type { Database } from '../client.js';

/** Drizzle/postgres-js returns either a row list or `{ rows }` depending on the driver version. */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/**
 * Durable, multi-worker queue on Postgres. Claims use `FOR UPDATE SKIP LOCKED`, so any number of API
 * instances and workers can drain it without ever picking the same run twice.
 */
export class PostgresRunQueue implements RunQueue {
  readonly driver = 'postgres';

  constructor(private readonly db: Database) {}

  async enqueue(runId: string, tenantId: string | null, maxAttempts: number): Promise<void> {
    // Raw `sql` templates bypass drizzle's column value-mapping, and the postgres-js prepared-statement
    // path rejects Date instances outright (Buffer.byteLength on a Date throws ERR_INVALID_ARG_TYPE).
    // Pass an ISO string instead: timestamptz parses it unambiguously as UTC.
    const now = new Date().toISOString();
    await this.db.execute(sql`
      INSERT INTO jobs (
        id, run_id, tenant_id, status, attempts, max_attempts, available_at, cancel_requested,
        created_at, updated_at
      )
      VALUES (${newId()}, ${runId}, ${tenantId}, 'queued', 0, ${maxAttempts}, ${now}, false, ${now}, ${now})
      ON CONFLICT (run_id) DO UPDATE SET
        status = 'queued',
        attempts = 0,
        available_at = ${now},
        cancel_requested = false,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = ${now}
    `);
  }

  async claim(workerId: string): Promise<RunQueueJob | null> {
    const result = await this.db.execute(sql`
      UPDATE jobs
      SET status = 'running',
          locked_at = now(),
          locked_by = ${workerId},
          attempts = attempts + 1,
          updated_at = now()
      WHERE run_id = (
        SELECT run_id FROM jobs
        WHERE status = 'queued' AND available_at <= now()
        ORDER BY available_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING run_id, tenant_id, attempts
    `);
    const row = rowsOf<{ run_id: string; tenant_id: string | null; attempts: number }>(result)[0];
    return row ? { runId: row.run_id, tenantId: row.tenant_id, attempts: row.attempts } : null;
  }

  async complete(runId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs
      SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now()
      WHERE run_id = ${runId}
    `);
  }

  async fail(runId: string, error: string, retryDelayMs: number): Promise<'retry' | 'dead'> {
    const result = await this.db.execute(sql`
      UPDATE jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
          available_at = CASE
            WHEN attempts >= max_attempts THEN available_at
            ELSE now() + make_interval(secs => ${retryDelayMs / 1000})
          END,
          last_error = ${error},
          locked_at = NULL,
          locked_by = NULL,
          updated_at = now()
      WHERE run_id = ${runId}
      RETURNING status
    `);
    const status = rowsOf<{ status: string }>(result)[0]?.status;
    return status === 'queued' ? 'retry' : 'dead';
  }

  /**
   * Marks the job cancelled. The row stays claimable so the dispatcher can observe the flag and mark
   * the run failed; only a job that has not been created yet is a no-op.
   */
  async cancel(runId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs
      SET cancel_requested = true, updated_at = now()
      WHERE run_id = ${runId}
    `);
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT cancel_requested FROM jobs WHERE run_id = ${runId} LIMIT 1
    `);
    return rowsOf<{ cancel_requested: boolean }>(result)[0]?.cancel_requested === true;
  }

  async recoverStale(staleMs: number): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE jobs
      SET status = 'queued', locked_at = NULL, locked_by = NULL, updated_at = now()
      WHERE status = 'running'
        AND locked_at < now() - make_interval(secs => ${staleMs / 1000})
      RETURNING run_id
    `);
    return rowsOf<{ run_id: string }>(result).length;
  }

  async depth(): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT count(*)::int AS value FROM jobs WHERE status = 'queued'
    `);
    return rowsOf<{ value: number }>(result)[0]?.value ?? 0;
  }
}
