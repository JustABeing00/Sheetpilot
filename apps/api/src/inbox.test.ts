import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CapturingLogger } from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';
import { InboxService } from './services/inbox-service.js';
import { EVENTS_CSV, PRIMARY_CSV } from './fixtures.js';

describe('folder inbox watcher', () => {
  let container: AppContainer;
  let dir: string;
  let configurationId: string;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      REPOSITORY_DRIVER: 'memory',
      LOG_LEVEL: 'silent',
    });
    container = await createContainer(config, CapturingLogger.create(), {
      storage: new InMemoryFileStorage(),
    });

    const primary = await container.datasetService.ingest({
      kind: 'primary',
      originalName: 'primary_accounts.csv',
      mimeType: 'text/csv',
      content: Buffer.from(PRIMARY_CSV, 'utf8'),
    });
    const events = await container.datasetService.ingest({
      kind: 'events',
      originalName: 'fault_events.csv',
      mimeType: 'text/csv',
      content: Buffer.from(EVENTS_CSV, 'utf8'),
    });

    const configuration = await container.workflowConfigurationService.create({
      workflowSlug: 'account-fault-triage',
      name: 'Inbox workflow',
      description: '',
      assignments: [
        { role: 'primary', datasetId: primary.dataset.id, sheetName: null },
        { role: 'events', datasetId: events.dataset.id, sheetName: null },
      ],
      mappings: [
        {
          role: 'primaryEntityKey',
          datasetId: primary.dataset.id,
          sheetName: null,
          column: 'Account Number',
          confirmed: false,
        },
        {
          role: 'eventsEntityKey',
          datasetId: events.dataset.id,
          sheetName: null,
          column: 'Account Number',
          confirmed: false,
        },
        {
          role: 'eventsTimestamp',
          datasetId: events.dataset.id,
          sheetName: null,
          column: 'Fault Date',
          confirmed: false,
        },
        {
          role: 'eventsDescription',
          datasetId: events.dataset.id,
          sheetName: null,
          column: 'Fault Description',
          confirmed: false,
        },
      ],
      options: {},
    });
    configurationId = configuration.id;

    dir = await mkdtemp(path.join(tmpdir(), 'sheetpilot-inbox-'));
  });

  afterAll(async () => {
    await container.close();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ingests a dropped job, runs the saved workflow and archives the folder', async () => {
    const jobDir = path.join(dir, '2026-09-19');
    await mkdir(jobDir, { recursive: true });
    await writeFile(path.join(jobDir, 'primary.csv'), PRIMARY_CSV);
    await writeFile(path.join(jobDir, 'events.csv'), EVENTS_CSV);

    const inbox = new InboxService({
      dir,
      configurationId,
      primaryPattern: 'primary.*',
      eventsPattern: 'events.*',
      pollIntervalMs: 3_600_000,
      settleMs: 50,
      datasetService: container.datasetService,
      savedWorkflowService: container.savedWorkflowService,
      repositories: container.repositories,
      clock: container.clock,
      logger: CapturingLogger.create(),
    });

    try {
      // First sweep only observes the files (waiting for the copy to finish).
      await inbox.start();
      await new Promise((resolve) => setTimeout(resolve, 60));
      const result = await inbox.sweep();

      expect(result.jobsProcessed).toBe(1);
      expect(result.jobsFailed).toBe(0);
      expect(result.runIds).toHaveLength(1);

      const run = await container.repositories.runs.getById(result.runIds[0]!);
      expect(run?.status).toBe('succeeded');
      expect(run?.stats['accounts']).toBe(9);

      // The job folder is moved aside so it is never processed twice.
      const entries = await readdir(dir);
      expect(entries).not.toContain('2026-09-19');
      expect(entries).toContain('_processed');
    } finally {
      inbox.stop();
    }
  });

  it('ignores an empty job folder until both files are present', async () => {
    const jobDir = path.join(dir, 'incomplete');
    await mkdir(jobDir, { recursive: true });
    await writeFile(path.join(jobDir, 'primary.csv'), PRIMARY_CSV);

    const inbox = new InboxService({
      dir,
      configurationId,
      primaryPattern: 'primary.*',
      eventsPattern: 'events.*',
      pollIntervalMs: 3_600_000,
      settleMs: 50,
      datasetService: container.datasetService,
      savedWorkflowService: container.savedWorkflowService,
      repositories: container.repositories,
      clock: container.clock,
      logger: CapturingLogger.create(),
    });

    try {
      const first = await inbox.sweep();
      await new Promise((resolve) => setTimeout(resolve, 60));
      const second = await inbox.sweep();
      expect(first.jobsProcessed).toBe(0);
      expect(second.jobsProcessed).toBe(0);
      expect(await readdir(dir)).toContain('incomplete');
    } finally {
      inbox.stop();
    }
  });
});
