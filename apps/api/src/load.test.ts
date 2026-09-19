import { describe, expect, it } from 'vitest';
import { CapturingLogger, fileAssetSchema, newId, systemClock } from '@sheetpilot/core';
import { createInMemoryRepositories, InMemoryRunQueue } from '@sheetpilot/db';
import {
  InMemoryFileStorage,
  XlsxTabularWriter,
  writeTableToBuffer,
  type Row,
} from '@sheetpilot/file-processing';
import { createClassificationProvider } from '@sheetpilot/ai';
import { createDefaultWorkflowRegistry } from '@sheetpilot/workflow-engine';
import { RunDispatcher } from './services/run-dispatcher.js';
import { RunService } from './services/run-service.js';

/**
 * Load guard: a realistically large pair of XLSX files must flow through the whole pipeline (inspect →
 * match → classify → rules → artifacts) without pathological slowdown. The size is deliberately modest
 * so the suite stays fast; the generous ceiling catches accidental O(n²) regressions rather than CI jitter.
 */
const ACCOUNT_COUNT = 10_000;
const EVENTS_PER_ACCOUNT = 3;
const PRIMARY_COLUMNS = [
  'Account Number',
  'Site Name',
  'RootCause',
  'FaultCategory',
  'RecommendedAction',
  'Priority',
];
const EVENT_COLUMNS = ['Account Number', 'Fault Date', 'Fault Description', 'Source'];
const FAULTS = [
  'No power detected at site',
  'Sensor fault on channel 2',
  'Communication timeout on gateway',
  'Breaker trip recorded',
  'Voltage sag detected',
];

function buildFixtureRows(): { primary: Row[]; events: Row[] } {
  const primary: Row[] = [];
  const events: Row[] = [];
  for (let index = 0; index < ACCOUNT_COUNT; index += 1) {
    const account = String(10_000 + index);
    primary.push({
      'Account Number': account,
      'Site Name': `Site ${index}`,
      RootCause: '',
      FaultCategory: '',
      RecommendedAction: '',
      Priority: '',
    });
    for (let eventIndex = 0; eventIndex < EVENTS_PER_ACCOUNT; eventIndex += 1) {
      const day = String((eventIndex % 28) + 1).padStart(2, '0');
      events.push({
        'Account Number': account,
        'Fault Date': `2026-03-${day} 08:00:00`,
        'Fault Description': FAULTS[(index + eventIndex) % FAULTS.length]!,
        Source: 'SCADA',
      });
    }
  }
  return { primary, events };
}

describe('large XLSX load', () => {
  it('runs a 10k-account / 30k-event XLSX pair end to end', async () => {
    const repositories = createInMemoryRepositories();
    const storage = new InMemoryFileStorage();
    const queue = new InMemoryRunQueue();
    const logger = CapturingLogger.create();
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

    const { primary: primaryRows, events: eventRows } = buildFixtureRows();
    const { buffer: primaryBuffer } = await writeTableToBuffer(
      new XlsxTabularWriter(),
      primaryRows,
      { columns: PRIMARY_COLUMNS, sheetName: 'Accounts' },
    );
    const { buffer: eventsBuffer } = await writeTableToBuffer(new XlsxTabularWriter(), eventRows, {
      columns: EVENT_COLUMNS,
      sheetName: 'Faults',
    });

    const now = new Date();
    const primaryFile = await repositories.files.create(
      fileAssetSchema.parse({
        id: newId(),
        kind: 'primary',
        originalName: 'accounts.xlsx',
        format: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: primaryBuffer.length,
        checksum: 'load-primary',
        storageKey: 'uploads/load-primary.xlsx',
        uploadedAt: now,
      }),
    );
    const eventsFile = await repositories.files.create(
      fileAssetSchema.parse({
        id: newId(),
        kind: 'events',
        originalName: 'faults.xlsx',
        format: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: eventsBuffer.length,
        checksum: 'load-events',
        storageKey: 'uploads/load-events.xlsx',
        uploadedAt: now,
      }),
    );
    await storage.put('uploads/load-primary.xlsx', primaryBuffer);
    await storage.put('uploads/load-events.xlsx', eventsBuffer);

    const startedAt = Date.now();
    const run = await runService.createRun({
      workflowSlug: 'account-fault-triage',
      primaryFileId: primaryFile.id,
      eventsFileId: eventsFile.id,
      config: {},
    });
    await dispatcher.tick();
    await dispatcher.drain();
    const elapsedMs = Date.now() - startedAt;

    const finished = await repositories.runs.getById(run.id);
    expect(finished?.status).toBe('succeeded');
    expect(finished?.stats['accounts']).toBe(ACCOUNT_COUNT);
    expect(await repositories.decisions.listByRun(run.id)).toHaveLength(ACCOUNT_COUNT);
    expect((await repositories.artifacts.listByRun(run.id)).length).toBeGreaterThan(0);
    expect(await queue.depth()).toBe(0);
    expect(elapsedMs).toBeLessThan(120_000);
  }, 240_000);
});
