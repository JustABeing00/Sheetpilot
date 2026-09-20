import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PostgresRunQueue } from './postgres-run-queue.js';
import type { Database } from '../client.js';

/**
 * Captures the queries PostgresRunQueue builds and rebuilds their bound parameters with the same
 * dialect production uses. Lets us assert driver-safety without a live database.
 */
function captureDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const db = {
    execute: vi.fn((query: SQL) => {
      const built = dialect.sqlToQuery(query);
      calls.push({ sql: built.sql, params: built.params });
      return Promise.resolve([]);
    }),
  } as unknown as Database;
  return { db, calls };
}

function expectDriverSafeParams(params: unknown[]): void {
  for (const param of params) {
    expect(
      param === null ||
        typeof param === 'string' ||
        typeof param === 'number' ||
        typeof param === 'boolean',
      `query param must be a driver-safe primitive, got: ${String(param)}`,
    ).toBe(true);
  }
}

describe('PostgresRunQueue driver-safe parameters', () => {
  it('enqueue passes no Date instances to the driver', async () => {
    const { db, calls } = captureDb();
    const queue = new PostgresRunQueue(db);

    await queue.enqueue('run-1', null, 2);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.sql).toContain('INSERT INTO jobs');
    expect(call.sql).toContain('ON CONFLICT (run_id)');
    // Regression: raw `sql` templates bypass drizzle's column value-mapping, and the postgres-js
    // prepared-statement path throws ERR_INVALID_ARG_TYPE on Date instances (Buffer.byteLength).
    expectDriverSafeParams(call.params);
    expect(call.params).not.toContain(undefined);
  });

  it('enqueue timestamps are UTC ISO strings the database can parse', async () => {
    const { db, calls } = captureDb();
    const queue = new PostgresRunQueue(db);

    const before = Date.now();
    await queue.enqueue('run-1', 'tenant-a', 3);
    const after = Date.now();

    const timestamps = calls[0]!.params.filter(
      (param): param is string => typeof param === 'string' && param.includes('T'),
    );
    expect(timestamps.length).toBeGreaterThan(0);
    for (const stamp of timestamps) {
      const parsed = Date.parse(stamp);
      expect(Number.isNaN(parsed)).toBe(false);
      expect(parsed).toBeGreaterThanOrEqual(before);
      expect(parsed).toBeLessThanOrEqual(after);
    }
  });

  it('every queue statement passes only driver-safe primitives', async () => {
    const { db, calls } = captureDb();
    const queue = new PostgresRunQueue(db);

    await queue.enqueue('run-1', 'tenant-a', 2);
    await queue.claim('worker-a');
    await queue.complete('run-1');
    await queue.fail('run-1', 'boom', 1000);
    await queue.cancel('run-1');
    await queue.isCancelRequested('run-1');
    await queue.recoverStale(60_000);
    await queue.depth();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expectDriverSafeParams(call.params);
      expect(call.params).not.toContain(undefined);
    }
  });
});
