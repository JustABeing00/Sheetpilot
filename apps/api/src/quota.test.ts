import { describe, expect, it } from 'vitest';
import {
  CapturingLogger,
  fileAssetSchema,
  newId,
  QuotaExceededError,
  systemClock,
  tenantSchema,
  type Repositories,
} from '@sheetpilot/core';
import { createInMemoryRepositories, InMemoryRunQueue } from '@sheetpilot/db';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createClassificationProvider } from '@sheetpilot/ai';
import { createDefaultWorkflowRegistry } from '@sheetpilot/workflow-engine';
import { DatasetService } from './services/dataset-service.js';
import { QuotaService } from './services/quota-service.js';
import { RunService } from './services/run-service.js';
import { WorkspaceService } from './services/workspace-service.js';
import { PRIMARY_CSV, EVENTS_CSV } from './fixtures.js';

async function makeTenant(
  repositories: Repositories,
  plan: 'free' | 'pro' | 'enterprise' = 'free',
) {
  const now = systemClock.now();
  return repositories.tenants.create(
    tenantSchema.parse({
      id: newId(),
      name: 'Acme',
      slug: `acme-${newId()}`,
      plan,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

function makeQuota(enforced: boolean) {
  const repositories = createInMemoryRepositories();
  const service = new QuotaService({
    repositories,
    clock: systemClock,
    logger: CapturingLogger.create(),
    enforced,
  });
  return { repositories, service };
}

describe('plan quotas and metering', () => {
  it('reports the plan, its limits and metered usage', async () => {
    const { repositories, service } = makeQuota(true);
    const tenant = await makeTenant(repositories);
    const now = systemClock.now();
    await repositories.memberships.create({
      id: newId(),
      tenantId: tenant.id,
      userId: 'user-1',
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    });
    repositories.datasets.countForTenant = () => Promise.resolve(3);
    repositories.runs.countForTenantSince = () => Promise.resolve(7);

    const snapshot = await service.snapshot(tenant.id);
    expect(snapshot.plan).toBe('free');
    expect(snapshot.planName).toBe('Free');
    expect(snapshot.limits).toEqual({ maxMembers: 3, maxDatasets: 25, maxRunsPerMonth: 100 });
    expect(snapshot.usage).toEqual({ members: 1, datasets: 3, runsThisMonth: 7 });
    expect(snapshot.periodStart).toMatch(/-01T00:00:00\.000Z$/);
  });

  it('blocks a run at the monthly limit and allows it on a larger plan', async () => {
    const { repositories, service } = makeQuota(true);
    const free = await makeTenant(repositories, 'free');
    const pro = await makeTenant(repositories, 'pro');
    repositories.runs.countForTenantSince = () => Promise.resolve(100);

    await expect(service.assertCanCreateRun(free.id)).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(service.assertCanCreateRun(pro.id)).resolves.toBeUndefined();
  });

  it('treats null limits as unlimited', async () => {
    const { repositories, service } = makeQuota(true);
    const enterprise = await makeTenant(repositories, 'enterprise');
    repositories.runs.countForTenantSince = () => Promise.resolve(1_000_000);
    repositories.datasets.countForTenant = () => Promise.resolve(1_000_000);
    await expect(service.assertCanCreateRun(enterprise.id)).resolves.toBeUndefined();
    await expect(service.assertCanUploadDataset(enterprise.id)).resolves.toBeUndefined();
  });

  it('does nothing while enforcement is disabled', async () => {
    const { repositories, service } = makeQuota(false);
    const tenant = await makeTenant(repositories);
    repositories.runs.countForTenantSince = () => Promise.resolve(10_000);
    await expect(service.assertCanCreateRun(tenant.id)).resolves.toBeUndefined();
  });

  it('meters each tenant separately', async () => {
    const { repositories, service } = makeQuota(true);
    const atLimit = await makeTenant(repositories);
    const below = await makeTenant(repositories);
    repositories.runs.countForTenantSince = (tenantId) =>
      Promise.resolve(tenantId === atLimit.id ? 100 : 1);

    await expect(service.assertCanCreateRun(atLimit.id)).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(service.assertCanCreateRun(below.id)).resolves.toBeUndefined();
  });

  it('refuses an invitation that would exceed the member limit', async () => {
    const repositories = createInMemoryRepositories();
    const quotas = new QuotaService({
      repositories,
      clock: systemClock,
      logger: CapturingLogger.create(),
      enforced: true,
    });
    const service = new WorkspaceService({
      repositories,
      clock: systemClock,
      logger: CapturingLogger.create(),
      quotas,
    });
    const workspace = await service.create('owner-1', 'Acme');
    repositories.memberships.countForTenant = () => Promise.resolve(3);

    await expect(
      service.invite(
        'owner-1',
        workspace.id,
        { email: 'newcomer@example.com', role: 'member' },
        'owner@example.com',
      ),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('refuses to enqueue a run through RunService at the limit', async () => {
    const repositories = createInMemoryRepositories();
    const storage = new InMemoryFileStorage();
    const queue = new InMemoryRunQueue();
    const logger = CapturingLogger.create();
    const quotas = new QuotaService({ repositories, clock: systemClock, logger, enforced: true });
    const classifier = createClassificationProvider({
      provider: 'noop',
      apiKey: null,
      model: null,
    });
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
      quotas,
      clock: systemClock,
      logger,
    });

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
    await storage.put('uploads/primary.csv', PRIMARY_CSV);
    await storage.put('uploads/events.csv', EVENTS_CSV);
    repositories.runs.countForTenantSince = () => Promise.resolve(100);

    await expect(
      runService.createRun({
        workflowSlug: 'account-fault-triage',
        primaryFileId: primary.id,
        eventsFileId: events.id,
        config: {},
        tenantId: 'tenant-1',
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await queue.depth()).toBe(0);
  });

  it('refuses a dataset upload at the limit', async () => {
    const repositories = createInMemoryRepositories();
    const logger = CapturingLogger.create();
    const quotas = new QuotaService({ repositories, clock: systemClock, logger, enforced: true });
    const service = new DatasetService({
      repositories,
      storage: new InMemoryFileStorage(),
      clock: systemClock,
      logger,
      quotas,
      limits: {
        maxUploadBytes: 5 * 1024 * 1024,
        maxXlsxUncompressedBytes: 50 * 1024 * 1024,
        maxXlsxEntries: 1000,
        sampleRows: 10,
        maxScanRows: 100,
      },
    });
    repositories.datasets.countForTenant = () => Promise.resolve(25);

    await expect(
      service.ingest(
        {
          kind: 'primary',
          originalName: 'small.csv',
          mimeType: 'text/csv',
          content: Buffer.from('account,note\n1,ok\n'),
        },
        'tenant-1',
      ),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });
});
