import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CapturingLogger, reviewItemSchema, workflowRunSchema } from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';
import { PRIMARY_CSV } from './fixtures.js';

const WORKFLOW = 'account-fault-triage';

let container: AppContainer;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: 'test' });
  container = await createContainer(config, CapturingLogger.create(), {
    storage: new InMemoryFileStorage(),
  });
});

afterAll(async () => {
  await container.close();
});

async function ingestFor(tenantId: string, name: string) {
  return container.datasetService.ingest(
    {
      kind: 'generic',
      originalName: name,
      mimeType: 'text/csv',
      content: Buffer.from(PRIMARY_CSV),
    },
    tenantId,
  );
}

describe('tenant isolation', () => {
  it('scopes datasets: a tenant cannot read or list another tenant’s data', async () => {
    const a = await ingestFor('tenant-a', 'a.csv');
    const b = await ingestFor('tenant-b', 'b.csv');

    const listA = await container.datasetService.list(100, 0, 'tenant-a');
    expect(listA.map((dataset) => dataset.id)).toEqual([a.dataset.id]);

    const listB = await container.datasetService.list(100, 0, 'tenant-b');
    expect(listB.map((dataset) => dataset.id)).toEqual([b.dataset.id]);

    await expect(container.datasetService.getById(b.dataset.id, 'tenant-a')).rejects.toThrow();
    const own = await container.datasetService.getById(a.dataset.id, 'tenant-a');
    expect(own.id).toBe(a.dataset.id);
  });

  it('scopes uploaded files', async () => {
    const a = await container.fileService.list(100, 'tenant-a');
    const b = await container.fileService.list(100, 'tenant-b');

    expect(a.every((file) => file.tenantId === 'tenant-a')).toBe(true);
    expect(b.some((file) => file.tenantId === 'tenant-b')).toBe(true);

    const [sampleB] = b;
    expect(sampleB).toBeDefined();
    expect(await container.fileService.getById(sampleB!.id, 'tenant-a')).toBeNull();
  });

  it('scopes rule sets per tenant', async () => {
    await container.ruleSetService.create(
      { workflowSlug: WORKFLOW, name: 'A rules', rules: [], activate: true },
      'tenant-a',
    );
    await container.ruleSetService.create(
      { workflowSlug: WORKFLOW, name: 'B rules', rules: [], activate: true },
      'tenant-b',
    );

    const a = await container.ruleSetService.list(WORKFLOW, 'tenant-a');
    const b = await container.ruleSetService.list(WORKFLOW, 'tenant-b');

    expect(a.map((ruleSet) => ruleSet.name)).toEqual(['A rules']);
    expect(b.map((ruleSet) => ruleSet.name)).toEqual(['B rules']);

    const activeA = await container.ruleSetService.getActiveForWorkflow(WORKFLOW, 'tenant-a');
    expect(activeA?.name).toBe('A rules');
  });

  it('scopes runs in list queries', async () => {
    const a = await container.fileService.list(1, 'tenant-a');
    const fileId = a[0]!.id;

    await container.repositories.runs.create(
      workflowRunSchema.parse({
        id: 'run-tenant-a',
        tenantId: 'tenant-a',
        workflowId: `wf-${WORKFLOW}`,
        workflowSlug: WORKFLOW,
        workflowVersion: 1,
        status: 'succeeded',
        primaryFileId: fileId,
        eventsFileId: fileId,
        config: {},
        stats: {},
        createdAt: new Date(),
        finishedAt: new Date(),
      }),
    );

    const aRuns = await container.repositories.runs.list({ tenantId: 'tenant-a' });
    const bRuns = await container.repositories.runs.list({ tenantId: 'tenant-b' });

    expect(aRuns.map((run) => run.id)).toContain('run-tenant-a');
    expect(bRuns.map((run) => run.id)).not.toContain('run-tenant-a');
  });

  it('scopes review items and queue counts', async () => {
    const now = new Date();
    await container.repositories.reviewItems.createMany([
      reviewItemSchema.parse({
        id: 'item-a',
        tenantId: 'tenant-a',
        runId: 'run-tenant-a',
        entityKey: '1001',
        reason: 'low_confidence',
        severity: 'warning',
        status: 'open',
        title: 'Needs a decision',
        detail: '',
        createdAt: now,
      }),
    ]);

    const aItems = await container.repositories.reviewItems.list({ tenantId: 'tenant-a' });
    const bItems = await container.repositories.reviewItems.list({ tenantId: 'tenant-b' });

    expect(aItems.map((item) => item.id)).toContain('item-a');
    expect(bItems).toHaveLength(0);

    expect(await container.repositories.reviewItems.countOpen('tenant-b')).toBe(0);
    expect((await container.repositories.reviewItems.counts('tenant-b')).total).toBe(0);
    expect((await container.repositories.reviewItems.counts('tenant-a')).total).toBe(1);
  });
});
