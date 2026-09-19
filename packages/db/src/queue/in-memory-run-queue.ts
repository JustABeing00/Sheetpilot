import type { RunQueue, RunQueueJob } from '@sheetpilot/core';

interface Entry {
  runId: string;
  tenantId: string | null;
  attempts: number;
  maxAttempts: number;
  status: 'queued' | 'running' | 'done' | 'dead';
  availableAt: number;
  claimedAt: number | null;
  cancelRequested: boolean;
}

/**
 * In-process queue for development, tests and trusted single-process deployments. Jobs live only in
 * memory, so a restart strands them — the Postgres queue is the durable choice in production.
 */
export class InMemoryRunQueue implements RunQueue {
  readonly driver = 'memory';
  private readonly entries = new Map<string, Entry>();

  enqueue(runId: string, tenantId: string | null, maxAttempts: number): Promise<void> {
    this.entries.set(runId, {
      runId,
      tenantId,
      attempts: 0,
      maxAttempts,
      status: 'queued',
      availableAt: Date.now(),
      claimedAt: null,
      cancelRequested: false,
    });
    return Promise.resolve();
  }

  claim(_workerId?: string): Promise<RunQueueJob | null> {
    const now = Date.now();
    for (const entry of this.entries.values()) {
      // A cancelled job is still claimed (once) so the dispatcher can mark its run failed.
      if (entry.status === 'queued' && entry.availableAt <= now) {
        entry.status = 'running';
        entry.claimedAt = now;
        entry.attempts += 1;
        return Promise.resolve({
          runId: entry.runId,
          tenantId: entry.tenantId,
          attempts: entry.attempts,
        });
      }
    }
    return Promise.resolve(null);
  }

  complete(runId: string): Promise<void> {
    const entry = this.entries.get(runId);
    if (entry) {
      entry.status = 'done';
      entry.claimedAt = null;
    }
    return Promise.resolve();
  }

  fail(runId: string, _error: string, retryDelayMs: number): Promise<'retry' | 'dead'> {
    const entry = this.entries.get(runId);
    if (!entry) {
      return Promise.resolve('dead');
    }
    entry.claimedAt = null;
    if (entry.attempts >= entry.maxAttempts) {
      entry.status = 'dead';
      return Promise.resolve('dead');
    }
    entry.status = 'queued';
    entry.availableAt = Date.now() + retryDelayMs;
    return Promise.resolve('retry');
  }

  /**
   * Marks the job cancelled but leaves a queued job claimable: the dispatcher claims it, sees the
   * cancellation flag and marks the run failed — matching the Postgres queue, so a cancelled run never
   * stays "queued" forever.
   */
  cancel(runId: string): Promise<void> {
    const entry = this.entries.get(runId);
    if (entry) {
      entry.cancelRequested = true;
    }
    return Promise.resolve();
  }

  isCancelRequested(runId: string): Promise<boolean> {
    return Promise.resolve(this.entries.get(runId)?.cancelRequested ?? false);
  }

  /** Mirrors the Postgres queue: a running job whose lock is older than `staleMs` is requeued. */
  recoverStale(staleMs: number): Promise<number> {
    const now = Date.now();
    let recovered = 0;
    for (const entry of this.entries.values()) {
      if (
        entry.status === 'running' &&
        entry.claimedAt !== null &&
        entry.claimedAt <= now - staleMs
      ) {
        entry.status = 'queued';
        entry.claimedAt = null;
        entry.availableAt = now;
        recovered += 1;
      }
    }
    return Promise.resolve(recovered);
  }

  depth(): Promise<number> {
    return Promise.resolve(
      [...this.entries.values()].filter((entry) => entry.status === 'queued').length,
    );
  }
}
