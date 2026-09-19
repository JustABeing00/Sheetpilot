import { describe, expect, it } from 'vitest';
import { InMemoryRunQueue } from './in-memory-run-queue.js';

describe('InMemoryRunQueue stale-lock recovery', () => {
  it('requeues a job whose worker lock has expired', async () => {
    const queue = new InMemoryRunQueue();
    await queue.enqueue('run-1', 'tenant-a', 3);

    const first = await queue.claim('worker-a');
    expect(first?.runId).toBe('run-1');

    // The lock is fresh, so nothing is recovered yet.
    expect(await queue.recoverStale(60_000)).toBe(0);
    expect(await queue.depth()).toBe(0);

    // Once the lock is older than the threshold it is claimable again.
    expect(await queue.recoverStale(0)).toBe(1);
    expect(await queue.depth()).toBe(1);
    const second = await queue.claim('worker-b');
    expect(second?.runId).toBe('run-1');
    expect(second?.attempts).toBe(2);
  });

  it('never recovers jobs that finished, failed permanently or are waiting to retry', async () => {
    const queue = new InMemoryRunQueue();
    await queue.enqueue('done', null, 2);
    await queue.claim('worker-a');
    await queue.complete('done');

    await queue.enqueue('dead', null, 1);
    await queue.claim('worker-a');
    expect(await queue.fail('dead', 'boom', 0)).toBe('dead');

    await queue.enqueue('retrying', null, 2);
    await queue.claim('worker-a');
    expect(await queue.fail('retrying', 'boom', 0)).toBe('retry');

    expect(await queue.recoverStale(0)).toBe(0);
    expect(await queue.depth()).toBe(1);
  });
});
