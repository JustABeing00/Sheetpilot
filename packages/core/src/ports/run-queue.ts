/** A claimed unit of work: the run to execute and its retry bookkeeping. */
export interface RunQueueJob {
  runId: string;
  tenantId: string | null;
  attempts: number;
}

/**
 * Durable scheduling for workflow runs. The API enqueues; a dispatcher (in-process for a single
 * service, or the dedicated worker) claims, executes and completes. A Postgres-backed queue is what
 * lets runs survive an API restart and lets the API scale past one instance.
 */
export interface RunQueue {
  readonly driver: string;
  enqueue(runId: string, tenantId: string | null, maxAttempts: number): Promise<void>;
  /** Atomically claims the next available job for this worker, or null when the queue is empty. */
  claim(workerId: string): Promise<RunQueueJob | null>;
  complete(runId: string): Promise<void>;
  /**
   * Records a failure. Returns `retry` when the job was requeued for another attempt and `dead` when
   * its attempts are exhausted (the run is left failed).
   */
  fail(runId: string, error: string, retryDelayMs: number): Promise<'retry' | 'dead'>;
  cancel(runId: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  /** Requeues jobs whose worker lock is older than `staleMs` (a crashed process). Returns the count. */
  recoverStale(staleMs: number): Promise<number>;
  /** Number of jobs waiting to be claimed. */
  depth(): Promise<number>;
}
