import { describe, expect, it } from 'vitest';
import { CapturingLogger } from '@sheetpilot/core';
import { InMemoryRunQueue } from '@sheetpilot/db';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { RunService } from './services/run-service.js';
import { RunDispatcher } from './services/run-dispatcher.js';
import { createInMemoryRepositories } from '@sheetpilot/db';
import { createDefaultWorkflowRegistry } from '@sheetpilot/workflow-engine';
import { createClassificationProvider } from '@sheetpilot/ai';
import { systemClock, fileAssetSchema, newId } from '@sheetpilot/core';
import { PRIMARY_CSV, EVENTS_CSV } from './fixtures.js';

function makeHarness() {
  const repositories = createInMemoryRepositories();
  const storage = new InMemoryFileStorage();
  const queue = new InMemoryRunQueue();
  const logger = CapturingLogger.create();
  const classifier = createClassificationProvider({ provider: 'noop', apiKey: null, model: null });
  const registry = createDefaultWorkflowRegistry({
    files: repositories.files,
    storage,
    classifier,
    logger,
  });
  const runService = new RunService({
    repositories,
    storage,
    registry,
    queue,
    maxAttempts: 2,
    clock: systemClock,
    logger,
  });
  const dispatcher = new RunDispatcher({
    queue,
    runService,
    logger,
    pollIntervalMs: 50,
    staleLockMs: 60_000,
    retryDelayMs: 10,
  });
  return { repositories, storage, queue, runService, dispatcher, registry };
}

async function seedFiles(repositories: ReturnType<typeof createInMemoryRepositories>) {
  const now = new Date();
  const primary = await repositories.files.create(
    fileAssetSchema.parse({
      id: newId(),
      kind: 'primary',
      originalName: 'primary.csv',
      format: 'csv',
      mimeType: 'text/csv',
      sizeBytes: PRIMARY_CSV.length,
      checksum: 'primary',
      storageKey: 'uploads/primary.csv',
      uploadedAt: now,
    }),
  );
  const events = await repositories.files.create(
    fileAssetSchema.parse({
      id: newId(),
      kind: 'events',
      originalName: 'events.csv',
      format: 'csv',
      mimeType: 'text/csv',
      sizeBytes: EVENTS_CSV.length,
      checksum: 'events',
      storageKey: 'uploads/events.csv',
      uploadedAt: now,
    }),
  );
  return { primary, events };
}

describe('durable run queue', () => {
  it('enqueues a run and the dispatcher executes it to success', async () => {
    const { repositories, storage, queue, runService, dispatcher } = makeHarness();
    const { primary, events } = await seedFiles(repositories);
    await storage.put('uploads/primary.csv', PRIMARY_CSV);
    await storage.put('uploads/events.csv', EVENTS_CSV);

    const run = await runService.createRun({
      workflowSlug: 'account-fault-triage',
      primaryFileId: primary.id,
      eventsFileId: events.id,
      config: {},
      tenantId: 'tenant-a',
    });

    // Creating a run only enqueues it; it must not execute inline.
    expect((await repositories.runs.getById(run.id))?.status).toBe('queued');
    expect(await queue.depth()).toBe(1);

    await dispatcher.tick();
    await dispatcher.drain();

    const finished = await repositories.runs.getById(run.id);
    expect(finished?.status).toBe('succeeded');
    expect(await queue.depth()).toBe(0);
    expect((await repositories.artifacts.listByRun(run.id)).length).toBeGreaterThan(0);
  });

  it('retries a failed run up to maxAttempts and then gives up', async () => {
    const { queue } = makeHarness();
    await queue.enqueue('run-retry', null, 2);

    const first = await queue.claim('test-worker');
    expect(first?.runId).toBe('run-retry');
    expect(first?.attempts).toBe(1);
    expect(await queue.fail('run-retry', 'boom', 0)).toBe('retry');

    const second = await queue.claim('test-worker');
    expect(second?.attempts).toBe(2);
    expect(await queue.fail('run-retry', 'boom again', 0)).toBe('dead');
    expect(await queue.depth()).toBe(0);
  });

  it('does not run a job twice across concurrent claims', async () => {
    const { queue } = makeHarness();
    await queue.enqueue('run-1', null, 2);

    const [a, b] = await Promise.all([queue.claim('w1'), queue.claim('w2')]);
    const claimed = [a, b].filter((job) => job !== null);
    expect(claimed).toHaveLength(1);
  });

  it('cancels a queued run so the dispatcher skips it', async () => {
    const { repositories, queue, runService, dispatcher } = makeHarness();
    const { primary, events } = await seedFiles(repositories);

    const run = await runService.createRun({
      workflowSlug: 'account-fault-triage',
      primaryFileId: primary.id,
      eventsFileId: events.id,
      config: {},
    });

    await queue.cancel(run.id);
    await dispatcher.tick();
    await dispatcher.drain();

    const cancelled = await repositories.runs.getById(run.id);
    expect(cancelled?.status).toBe('failed');
    expect(cancelled?.error).toMatch(/cancel/i);
  });

  it('prepareForExecution clears partial results so a retry cannot duplicate them', async () => {
    const { repositories, storage, queue, runService, dispatcher } = makeHarness();
    const { primary, events } = await seedFiles(repositories);
    await storage.put('uploads/primary.csv', PRIMARY_CSV);
    await storage.put('uploads/events.csv', EVENTS_CSV);

    const run = await runService.createRun({
      workflowSlug: 'account-fault-triage',
      primaryFileId: primary.id,
      eventsFileId: events.id,
      config: {},
    });

    await dispatcher.tick();
    await dispatcher.drain();
    const firstArtifacts = (await repositories.artifacts.listByRun(run.id)).length;
    expect(firstArtifacts).toBeGreaterThan(0);

    // Simulate a crash-and-retry: the run is reset and re-enqueued as a fresh job.
    await runService.prepareForExecution(run.id);
    expect(await repositories.artifacts.listByRun(run.id)).toHaveLength(0);
    expect((await repositories.decisions.listByRun(run.id)).length).toBe(0);
    await queue.enqueue(run.id, null, 2);

    await dispatcher.tick();
    await dispatcher.drain();
    expect((await repositories.artifacts.listByRun(run.id)).length).toBe(firstArtifacts);
  });
});
