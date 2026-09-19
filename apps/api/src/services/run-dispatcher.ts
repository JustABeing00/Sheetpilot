import { randomUUID } from 'node:crypto';
import type { Logger, RunQueue } from '@sheetpilot/core';
import type { RunService } from './run-service.js';

export interface RunDispatcherDeps {
  queue: RunQueue;
  runService: RunService;
  logger: Logger;
  pollIntervalMs: number;
  staleLockMs: number;
  retryDelayMs: number;
  /** Number of runs executed concurrently by this dispatcher. */
  concurrency?: number;
}

/**
 * Drains the durable run queue. The same loop runs in-process on the API (single-service deployments)
 * or inside the dedicated worker process (`--worker`), so scaling out is a deployment choice, not a
 * code change. Jobs are claimed atomically, so multiple dispatchers never run the same job twice.
 */
export class RunDispatcher {
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private readonly concurrency: number;
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly deps: RunDispatcherDeps) {
    this.concurrency = deps.concurrency ?? 1;
  }

  async tick(): Promise<number> {
    let processed = 0;
    while (!this.stopping && this.inFlight.size < this.concurrency) {
      const job = await this.deps.queue.claim(this.workerId);
      if (!job) {
        break;
      }
      const task = this.process(job.runId).finally(() => {
        this.inFlight.delete(task);
      });
      this.inFlight.add(task);
      processed += 1;
    }
    return processed;
  }

  private async process(runId: string): Promise<void> {
    const log = this.deps.logger.child({ runId, workerId: this.workerId });
    try {
      if (await this.deps.queue.isCancelRequested(runId)) {
        await this.deps.runService.markCancelled(runId);
        await this.deps.queue.complete(runId);
        log.info({}, 'run was cancelled before it started');
        return;
      }

      await this.deps.runService.prepareForExecution(runId);
      const result = await this.deps.runService.execute(runId);

      if (result.ok) {
        await this.deps.queue.complete(runId);
        return;
      }

      const outcome = await this.deps.queue.fail(
        runId,
        result.error ?? 'The run failed.',
        this.deps.retryDelayMs,
      );
      if (outcome === 'retry') {
        log.warn({ error: result.error }, 'run failed; requeued for another attempt');
      } else {
        log.error({ error: result.error }, 'run failed; no attempts left');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const outcome = await this.deps.queue.fail(runId, message, this.deps.retryDelayMs);
      log.error({ err: error, outcome }, 'run execution threw unexpectedly');
    }
  }

  /**
   * Runs one dispatch cycle without waiting for the claimed job to finish (fire-and-forget). Called
   * when a run is enqueued so an in-process dispatcher starts it immediately instead of on the next poll.
   */
  kick(): void {
    void this.tick().catch((error: unknown) => {
      this.deps.logger.error({ err: error }, 'run dispatcher kick failed');
    });
  }

  /** Waits for the currently claimed jobs to finish. Used by tests and graceful shutdown. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.deps.logger.error({ err: error }, 'run dispatcher tick failed');
      });
    }, this.deps.pollIntervalMs);
    this.timer.unref?.();
    void this.tick().catch((error: unknown) => {
      this.deps.logger.error({ err: error }, 'initial run dispatcher tick failed');
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.drain();
  }

  /** Requeues jobs whose worker lock expired (a crashed process). */
  async recoverStale(): Promise<number> {
    return this.deps.queue.recoverStale(this.deps.staleLockMs);
  }
}
