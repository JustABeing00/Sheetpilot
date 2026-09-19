import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  artifactSchema,
  CapturingLogger,
  reviewItemSchema,
  runSnapshotSchema,
  workflowRunSchema,
} from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';

let container: AppContainer;
let storage: InMemoryFileStorage;

beforeAll(async () => {
  storage = new InMemoryFileStorage();
  const config = loadConfig({ NODE_ENV: 'test' });
  container = await createContainer(config, CapturingLogger.create(), { storage });
});

afterAll(async () => {
  await container.close();
});

describe('DeletionService', () => {
  it('deletes a run, its children and its generated objects', async () => {
    const now = new Date();
    const runId = 'run-delete-me';
    const storageKey = `runs/${runId}/output.csv`;

    await storage.put(storageKey, 'Account,RootCause\n1001,Power Loss\n');

    await container.repositories.runs.create(
      workflowRunSchema.parse({
        id: runId,
        tenantId: 'tenant-a',
        workflowId: 'wf-account-fault-triage',
        workflowSlug: 'account-fault-triage',
        workflowVersion: 1,
        status: 'succeeded',
        primaryFileId: 'file-1',
        eventsFileId: 'file-2',
        config: {},
        stats: {},
        createdAt: now,
      }),
    );
    await container.repositories.runSnapshots.create(
      runSnapshotSchema.parse({
        id: 'snap-1',
        tenantId: 'tenant-a',
        runId,
        workflowSlug: 'account-fault-triage',
        workflowVersion: 1,
        capturedAt: now,
      }),
    );
    await container.repositories.artifacts.create(
      artifactSchema.parse({
        id: 'artifact-1',
        tenantId: 'tenant-a',
        runId,
        kind: 'output_csv',
        format: 'csv',
        fileName: 'output.csv',
        storageKey,
        sizeBytes: 24,
        createdAt: now,
      }),
    );
    await container.repositories.reviewItems.createMany([
      reviewItemSchema.parse({
        id: 'item-del',
        tenantId: 'tenant-a',
        runId,
        entityKey: '1001',
        reason: 'low_confidence',
        severity: 'warning',
        status: 'open',
        title: 'Needs a decision',
        detail: '',
        createdAt: now,
      }),
    ]);

    const result = await container.deletionService.deleteRun(runId, 'tenant-a');

    expect(result.artifactsRemoved).toBe(1);
    expect(await container.repositories.runs.getById(runId)).toBeNull();
    expect(await container.repositories.runSnapshots.getByRunId(runId)).toBeNull();
    expect(await container.repositories.artifacts.listByRun(runId)).toHaveLength(0);
    expect(await container.repositories.reviewItems.listByRun(runId)).toHaveLength(0);
    expect(await storage.exists(storageKey)).toBe(false);
  });

  it('refuses to delete a run owned by another tenant', async () => {
    await container.repositories.runs.create(
      workflowRunSchema.parse({
        id: 'run-other',
        tenantId: 'tenant-a',
        workflowId: 'wf-account-fault-triage',
        workflowSlug: 'account-fault-triage',
        workflowVersion: 1,
        status: 'succeeded',
        primaryFileId: 'file-1',
        eventsFileId: 'file-2',
        config: {},
        stats: {},
        createdAt: new Date(),
      }),
    );

    await expect(container.deletionService.deleteRun('run-other', 'tenant-b')).rejects.toThrow();
  });
});
