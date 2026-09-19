import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  configurationValidationResponseSchema,
  datasetDtoSchema,
  reviewItemDtoSchema,
  reviewQueueResponseSchema,
  runDtoSchema,
  workflowConfigurationDtoSchema,
  type DatasetDto,
  type RunDto,
} from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';

const WORKFLOW = 'account-fault-triage';

const PRIMARY_CSV = [
  'Account Number,Site Name,Root Cause,Fault Category,Action Required,Priority',
  'A001,North Ridge,,,,',
  'A004,Elm Street,,,,',
].join('\n');

const EVENTS_CSV = [
  'Account Number,Fault Date,Fault Description',
  'A001,2026-03-01 08:00:00,No power detected at site',
  'A001,2026-03-02 08:00:00,Battery low warning repeated',
  'A004,2026-03-02 11:15:00,Unknown telemetry anomaly',
].join('\n');

function multipartPayload(
  parts: Array<{ name: string; value: string; filename?: string; contentType?: string }>,
): { payload: Buffer; contentType: string } {
  const boundary = '----sheetpilot-output-columns-boundary';
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

async function uploadDataset(app: FastifyInstance, kind: string): Promise<DatasetDto> {
  const body = kind === 'primary' ? PRIMARY_CSV : EVENTS_CSV;
  const fileName = kind === 'primary' ? 'primary_accounts.csv' : 'fault_events.csv';
  const { payload, contentType } = multipartPayload([
    { name: 'kind', value: kind },
    { name: 'file', filename: fileName, value: body, contentType: 'text/csv' },
  ]);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/datasets',
    payload,
    headers: { 'content-type': contentType },
  });
  expect(response.statusCode).toBe(201);
  return datasetDtoSchema.parse(response.json());
}

async function waitForRun(app: FastifyInstance, runId: string): Promise<RunDto> {
  const deadline = Date.now() + 15_000;
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

async function downloadOutputCsv(app: FastifyInstance, runId: string): Promise<string> {
  const artifacts = (
    await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}/artifacts` })
  ).json<{ items: Array<{ id: string; kind: string }> }>();
  const csv = artifacts.items.find((artifact) => artifact.kind === 'output_csv');
  expect(csv).toBeDefined();
  const download = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${csv!.id}/download`,
  });
  expect(download.statusCode).toBe(200);
  return download.body;
}

function resolveItem(app: FastifyInstance, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/v1/review-items/${id}/resolve`, payload });
}

describe('output column mapping, combined fault summary and review write-back', () => {
  let app: FastifyInstance;
  let container: AppContainer;
  let primary: DatasetDto;
  let events: DatasetDto;

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

    primary = await uploadDataset(app, 'primary');
    events = await uploadDataset(app, 'events');
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it("writes results into the primary file's own result columns and summarises the fault history", async () => {
    const mappings = [
      {
        role: 'primaryEntityKey',
        datasetId: primary.id,
        sheetName: null,
        column: 'Account Number',
        confirmed: false,
      },
      {
        role: 'outputRootCauseColumn',
        datasetId: primary.id,
        sheetName: null,
        column: 'Root Cause',
        confirmed: false,
      },
      {
        role: 'outputFaultCategoryColumn',
        datasetId: primary.id,
        sheetName: null,
        column: 'Fault Category',
        confirmed: false,
      },
      {
        role: 'outputRecommendedActionColumn',
        datasetId: primary.id,
        sheetName: null,
        column: 'Action Required',
        confirmed: false,
      },
      {
        role: 'outputPriorityColumn',
        datasetId: primary.id,
        sheetName: null,
        column: 'Priority',
        confirmed: false,
      },
      {
        role: 'eventsEntityKey',
        datasetId: events.id,
        sheetName: null,
        column: 'Account Number',
        confirmed: false,
      },
      {
        role: 'eventsTimestamp',
        datasetId: events.id,
        sheetName: null,
        column: 'Fault Date',
        confirmed: false,
      },
      {
        role: 'eventsDescription',
        datasetId: events.id,
        sheetName: null,
        column: 'Fault Description',
        confirmed: false,
      },
    ];

    const validation = configurationValidationResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/workflow-configurations/validate',
          payload: {
            workflowSlug: WORKFLOW,
            assignments: [
              { role: 'primary', datasetId: primary.id, sheetName: null },
              { role: 'events', datasetId: events.id, sheetName: null },
            ],
            mappings,
            options: {},
          },
        })
      ).json(),
    );
    expect(validation.valid).toBe(true);
    expect(validation.resolvedConfig).toMatchObject({
      outputRootCauseColumn: 'Root Cause',
      outputFaultCategoryColumn: 'Fault Category',
      outputPriorityColumn: 'Priority',
    });

    const configuration = workflowConfigurationDtoSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/workflow-configurations',
          payload: {
            workflowSlug: WORKFLOW,
            name: 'Custom result columns',
            description: '',
            assignments: [
              { role: 'primary', datasetId: primary.id, sheetName: null },
              { role: 'events', datasetId: events.id, sheetName: null },
            ],
            mappings,
            options: {},
          },
        })
      ).json(),
    );

    const queued = runDtoSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/runs',
          payload: { configurationId: configuration.id, config: {} },
        })
      ).json(),
    );
    const run = await waitForRun(app, queued.id);
    expect(run.status).toBe('succeeded');

    let csv = await downloadOutputCsv(app, run.id);
    const header = csv.split('\n')[0]!;
    // The user's own columns are used; no canonical duplicates are invented.
    expect(header).toContain('"Root Cause"');
    expect(header).toContain('"Action Required"');
    expect(header).not.toContain('"RootCause"');
    expect(header).not.toContain('"RecommendedAction"');
    expect(header).toContain('"__FaultSummary"');

    const a001 = csv.split('\n').find((line) => line.startsWith('"A001"'))!;
    expect(a001).toContain('"Power"');
    expect(a001).toContain('No power detected at site | Battery low warning repeated');

    // A human override must land in the mapped real column, not a canonical one.
    const queue = reviewQueueResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/review-items?runId=${run.id}&limit=50` })
      ).json(),
    );
    const a004 = queue.items.find((item) => item.entityKey === 'A004')!;
    expect(a004).toBeDefined();
    const resolved = await resolveItem(app, a004.id, {
      action: 'overridden',
      values: { RootCause: 'Manual Cause', Priority: 'P1' },
      note: 'operator',
    });
    expect(resolved.statusCode).toBe(200);
    expect(reviewItemDtoSchema.parse(resolved.json()).state).toBe('OVERRIDDEN');

    csv = await downloadOutputCsv(app, run.id);
    const a004Line = csv.split('\n').find((line) => line.startsWith('"A004"'))!;
    expect(a004Line).toContain('"Manual Cause"');
    expect(a004Line).toContain('OVERRIDDEN');
  });

  it('keeps the identifier column and still writes a review decision back when it is excluded', async () => {
    const queued = runDtoSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/runs',
          payload: {
            workflowSlug: WORKFLOW,
            primaryFileId: primary.fileId,
            eventsFileId: events.fileId,
            config: {
              primaryAccountColumn: 'Account Number',
              eventsAccountColumn: 'Account Number',
              eventsTimestampColumn: 'Fault Date',
              eventsDescriptionColumn: 'Fault Description',
              // The user keeps only the site name; the identifier must still be present for write-back.
              primaryOutputColumns: ['Site Name'],
            },
          },
        })
      ).json(),
    );
    const run = await waitForRun(app, queued.id);
    expect(run.status).toBe('succeeded');

    const csv = await downloadOutputCsv(app, run.id);
    const header = csv.split('\n')[0]!;
    expect(header).toContain('"Account Number"');
    expect(header).toContain('"Site Name"');

    const queue = reviewQueueResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/review-items?runId=${run.id}&limit=50` })
      ).json(),
    );
    const target = queue.items[0]!;
    await resolveItem(app, target.id, {
      action: 'overridden',
      values: { RootCause: 'Write Back' },
      note: 'operator',
    });

    const updated = await downloadOutputCsv(app, run.id);
    const line = updated.split('\n').find((row) => row.startsWith(`"${target.entityKey}"`));
    expect(line).toBeDefined();
    expect(line).toContain('Write Back');
  });
});
