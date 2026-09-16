import type { Clock } from '@sheetpilot/core';

export interface IdempotentResult {
  statusCode: number;
  body: unknown;
}

interface Entry {
  expiresAt: number;
  result: Promise<IdempotentResult>;
}

/**
 * In-process idempotency for expensive, side-effecting endpoints (currently run creation). A client
 * sends an `Idempotency-Key` header; a replay of the same key returns the original response instead
 * of creating a second run. Concurrent duplicates share the in-flight promise. Failures are never
 * cached, so a client may retry after an error.
 *
 * This is intentionally process-local: with multiple API instances (or a restart) the guarantee is
 * lost, which is accurate for the current single-process deployment. Durable idempotency belongs in
 * the database alongside a real job queue.
 */
export class IdempotencyService {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: Clock,
  ) {}

  async run(
    key: string | null | undefined,
    operation: () => Promise<IdempotentResult>,
  ): Promise<{ replayed: boolean; result: IdempotentResult }> {
    if (!key || key.length === 0 || this.ttlMs <= 0) {
      return { replayed: false, result: await operation() };
    }

    const now = this.clock.now().getTime();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) {
      return { replayed: true, result: await existing.result };
    }

    const result = operation();
    this.entries.set(key, { expiresAt: now + this.ttlMs, result });

    try {
      return { replayed: false, result: await result };
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
  }

  pruneExpired(): number {
    const now = this.clock.now().getTime();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }
}
