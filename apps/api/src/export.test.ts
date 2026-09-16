import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  decisionListResponseSchema,
  exportStatusResponseSchema,
  runDtoSchema,
  type FileAssetDto,
  type RunDto,
} from '@sheetpilot/core';
import { createTabularReader, InMemoryFileStorage, readAllRows } from '@sheetpilot/file-processing';
import { loadConfig } from '@sheetpilot/config';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';
import { PRIMARY_CSV, EVENTS_CSV } from './fixtures.js';

function multipartPayload(
  parts: Array<{ name: string; value: string; filename?: string; contentType?: string }>,
): { payload: Buffer; contentType: string } {
  const boundary = '----sheetpilot-export-boundary';
  const chunks: string[] = [];
  for (const part of parts) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push(
      part.filename
        ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
        : `Content-Disposition: form-data; name="${part.name}"\r\n`,
    );
    if (part.contentType) {
      chunks.push(`Content-Type: ${part.contentType}\r\n`);
    }
    chunks.push('\r\n');
    chunks.push(part.value);
    chunks.push('\r\n');
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    payload: Buffer.from(chunks.join(''), 'utf8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(
  app: FastifyInstance,
  kind: string,
  filename: string,
  content: string,
): Promise<FileAssetDto> {
  const { payload, contentType } = multipartPayload([
    { name: 'kind', value: kind },
    { name: 'file', filename, value: content, contentType: 'text/csv' },
  ]);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/files',
    payload,
    headers: { 'content-type': contentType },
  });
  expect(response.statusCode).toBe(201);
  return response.json<FileAssetDto>();
}

async function waitForRun(app: FastifyInstance, runId: string): Promise<RunDto> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const run = runDtoSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` })).json(),
    );
    if (run.status === 'succeeded' || run.status === 'failed') {
      return run;
    }
    if (Date.now() > deadline) {
      throw new Error(`Run ${runId} did not finish (last: ${run.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function startRun(
  app: FastifyInstance,
  primary: FileAssetDto,
  events: FileAssetDto,
): Promise<RunDto> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/runs',
    payload: {
      workflowSlug: 'account-fault-triage',
      primaryFileId: primary.id,
      eventsFileId: events.id,
      config: {
        primaryAccountColumn: 'Account Number',
        eventsAccountColumn: 'Account Number',
        eventsTimestampColumn: 'Fault Date',
        eventsDescriptionColumn: 'Fault Description',
      },
    },
  });
  const queued = runDtoSchema.parse(created.json());
  const run = await waitForRun(app, queued.id);
  expect(run.status).toBe('succeeded');
  return run;
}

async function readXlsxSheet(app: FastifyInstance, artifactId: string, sheetName: string) {
  const download = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artifactId}/download`,
  });
  expect(download.statusCode).toBe(200);
  const buffer = download.rawPayload;
  return readAllRows(createTabularReader('xlsx'), Readable.from([buffer]), { sheetName });
}

const LEADING_ZERO_PRIMARY = [
  'Account Number,Site Name,RootCause,FaultCategory,RecommendedAction,Priority',
  '00123,Alpha,,,',
  '00456,Beta,,,',
  '00789,Gamma,,,',
  '',
].join('\n');

const LEADING_ZERO_EVENTS = [
  'Account Number,Fault Date,Fault Description,Source',
  '00123,2026-03-01 08:00:00,No power detected at site,SCADA',
  '00456,2026-03-02 09:00:00,No power detected,SCADA',
  '99999,2026-03-03 09:00:00,Orphan event,SCADA',
  '',
].join('\n');

describe('output generation & Excel export API', () => {
  let app: FastifyInstance;
  let container: AppContainer;
  let run: RunDto;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      REPOSITORY_DRIVER: 'memory',
      LOG_LEVEL: 'silent',
    });
    container = await createContainer(config, CapturingLogger.create(), {
      storage: new InMemoryFileStorage(),
    });
    app = buildServer(container, { startedAt: Date.now() });
    await app.ready();

    const primary = await upload(app, 'primary', 'primary_accounts.csv', PRIMARY_CSV);
    const events = await upload(app, 'events', 'fault_events.csv', EVENTS_CSV);
    run = await startRun(app, primary, events);
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('summarises the export, validates the generated files and reports pending review', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/export` });
    expect(response.statusCode).toBe(200);
    const status = exportStatusResponseSchema.parse(response.json());

    expect(status.status).toBe('pending_review');
    expect(status.ready).toBe(false);
    expect(status.summary.totalRecords).toBe(9);
    expect(status.summary.outputRows).toBe(10);
    expect(status.summary.autoResolved).toBe(2);
    expect(status.summary.unresolved).toBe(7);
    expect(status.summary.errors).toBe(0);

    const decisions = decisionListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/decisions?limit=200` })
      ).json(),
    );
    const expectedUnmatched = decisions.items.filter((decision) =>
      decision.reviewReasons.some((reason) => reason === 'no_events' || reason === 'no_rule_match'),
    ).length;
    expect(status.summary.unmatched).toBe(expectedUnmatched);

    expect(status.artifacts.map((artifact) => artifact.kind).sort()).toEqual([
      'output_csv',
      'output_xlsx',
    ]);
    expect(status.validation).not.toBeNull();
    expect(status.validation?.validated).toBe(true);
    expect(status.validation?.rowCount).toBe(10);
  });

  it('emits an XLSX with a Summary sheet and deterministic primary-file row order', async () => {
    const status = exportStatusResponseSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/export` })).json(),
    );
    const xlsx = status.artifacts.find((artifact) => artifact.kind === 'output_xlsx');
    expect(xlsx).toBeDefined();

    const described = await createTabularReader('xlsx').describe(
      await (async () => {
        const download = await app.inject({
          method: 'GET',
          url: `/api/v1/artifacts/${xlsx!.id}/download`,
        });
        return Readable.from([download.rawPayload]);
      })(),
    );
    expect(described.sheetNames).toEqual(['Summary', 'Output']);

    const summary = await readXlsxSheet(app, xlsx!.id, 'Summary');
    expect(summary.rows[0]).toMatchObject({ Metric: 'Total records', Value: 9 });
    const reviewRow = summary.rows.find((row) => row['Metric'] === 'Needs review');
    expect(reviewRow?.['Value']).toBe(7);

    const output = await readXlsxSheet(app, xlsx!.id, 'Output');
    expect(output.rowCount).toBe(10);
    expect(output.columns).toContain('RootCause');
    expect(output.columns).toContain('__ReviewStatus');
    expect(output.rows.map((row) => row['Account Number'])).toEqual([
      '1001',
      '1002',
      '1003',
      '1004',
      '1005',
      '1006',
      '1007',
      '1008',
      '1008',
      '1009',
    ]);
  });

  it('recomputes the summary live and marks the export ready once every case is reviewed', async () => {
    const queue = (
      await app.inject({ method: 'GET', url: `/api/v1/review-items?filter=unresolved&limit=200` })
    ).json<{ items: Array<{ id: string }> }>();
    for (const item of queue.items) {
      const resolved = await app.inject({
        method: 'POST',
        url: `/api/v1/review-items/${item.id}/resolve`,
        payload: { action: 'accepted', note: 'export test' },
      });
      expect(resolved.statusCode).toBe(200);
    }

    const status = exportStatusResponseSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/export` })).json(),
    );
    expect(status.status).toBe('ready');
    expect(status.ready).toBe(true);
    expect(status.summary.unresolved).toBe(0);
    expect(status.summary.reviewed).toBe(7);
    expect(status.summary.humanApproved).toBe(7);
    expect(status.summary.autoResolved).toBe(2);

    // Regeneration after a human decision must keep the Summary sheet and flip the patched rows.
    const xlsx = status.artifacts.find((artifact) => artifact.kind === 'output_xlsx')!;
    const described = await createTabularReader('xlsx').describe(
      await (async () => {
        const download = await app.inject({
          method: 'GET',
          url: `/api/v1/artifacts/${xlsx.id}/download`,
        });
        return Readable.from([download.rawPayload]);
      })(),
    );
    expect(described.sheetNames).toEqual(['Summary', 'Output']);
    const summary = await readXlsxSheet(app, xlsx.id, 'Summary');
    expect(summary.rows.find((row) => row['Metric'] === 'Total records')?.['Value']).toBe(9);

    const output = await readXlsxSheet(app, xlsx.id, 'Output');
    expect(output.rowCount).toBe(10);
    // Every human decision (including value-less accepts) is reflected in the regenerated file.
    expect(output.rows.some((row) => row['__ReviewStatus'] === 'REVIEW_REQUIRED')).toBe(false);
    expect(output.rows.filter((row) => row['__ReviewStatus'] === 'APPROVED').length).toBe(8);
  });

  it('preserves leading-zero account identifiers and source structure end to end', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      REPOSITORY_DRIVER: 'memory',
      LOG_LEVEL: 'silent',
    });
    const isolated = await createContainer(config, CapturingLogger.create(), {
      storage: new InMemoryFileStorage(),
    });
    const isolatedApp = buildServer(isolated, { startedAt: Date.now() });
    await isolatedApp.ready();

    try {
      const primary = await upload(
        isolatedApp,
        'primary',
        'leading_zero_primary.csv',
        LEADING_ZERO_PRIMARY,
      );
      const events = await upload(
        isolatedApp,
        'events',
        'leading_zero_events.csv',
        LEADING_ZERO_EVENTS,
      );
      const customRun = await startRun(isolatedApp, primary, events);

      const status = exportStatusResponseSchema.parse(
        (
          await isolatedApp.inject({ method: 'GET', url: `/api/v1/runs/${customRun.id}/export` })
        ).json(),
      );
      expect(status.summary.totalRecords).toBe(3);
      expect(status.summary.outputRows).toBe(3);
      expect(status.summary.autoResolved).toBe(2);
      expect(status.summary.unresolved).toBe(1);

      const xlsx = status.artifacts.find((artifact) => artifact.kind === 'output_xlsx')!;
      const output = await readXlsxSheet(isolatedApp, xlsx.id, 'Output');
      expect(output.rows.map((row) => row['Account Number'])).toEqual(['00123', '00456', '00789']);
      expect(typeof output.rows[0]?.['Account Number']).toBe('string');
      expect(output.rows[0]?.['RootCause']).toBe('Power Loss');
      // The account with no events keeps the four business columns blank, not zero or "undefined".
      expect(output.rows[2]?.['RootCause']).toBeNull();
      expect(output.rows[2]?.['Priority']).toBeNull();
      expect(output.rows[2]?.['__ReviewStatus']).toBe('REVIEW_REQUIRED');
    } finally {
      await isolatedApp.close();
      await isolated.close();
    }
  });
});
