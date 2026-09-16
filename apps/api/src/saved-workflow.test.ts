import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  datasetDtoSchema,
  prepareSavedWorkflowRunResponseSchema,
  runDtoSchema,
  runSnapshotDtoSchema,
  savedWorkflowDetailDtoSchema,
  savedWorkflowListResponseSchema,
  workflowConfigurationDtoSchema,
  type DatasetDto,
  type RunDto,
} from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';
import { PRIMARY_CSV, EVENTS_CSV } from './fixtures.js';

function multipartPayload(
  parts: Array<{ name: string; value: string; filename?: string; contentType?: string }>,
): { payload: Buffer; contentType: string } {
  const boundary = '----sheetpilot-saved-boundary';
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

async function uploadDataset(
  app: FastifyInstance,
  kind: string,
  filename: string,
  content: string,
): Promise<DatasetDto> {
  const { payload, contentType } = multipartPayload([
    { name: 'kind', value: kind },
    { name: 'file', filename, value: content, contentType: 'text/csv' },
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

function mappingsFor(primary: DatasetDto, events: DatasetDto) {
  return [
    {
      role: 'primaryEntityKey',
      datasetId: primary.id,
      sheetName: null,
      column: 'Account Number',
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
}

function assignmentsFor(primary: DatasetDto, events: DatasetDto) {
  return [
    { role: 'primary', datasetId: primary.id, sheetName: null },
    { role: 'events', datasetId: events.id, sheetName: null },
  ];
}

describe('saved workflow API', () => {
  let app: FastifyInstance;
  let container: AppContainer;
  let primary: DatasetDto;
  let events: DatasetDto;
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
    app = buildServer(container, { startedAt: Date.now() });
    await app.ready();

    primary = await uploadDataset(app, 'primary', 'primary_accounts.csv', PRIMARY_CSV);
    events = await uploadDataset(app, 'events', 'fault_events.csv', EVENTS_CSV);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-configurations',
      payload: {
        workflowSlug: 'account-fault-triage',
        name: 'Daily fault triage',
        description: 'Accounts plus fault events',
        assignments: assignmentsFor(primary, events),
        mappings: mappingsFor(primary, events),
        options: { reviewBelowConfidence: 0.8 },
      },
    });
    expect(created.statusCode).toBe(201);
    configurationId = workflowConfigurationDtoSchema.parse(created.json()).id;
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('lists a saved workflow before it has ever run', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/saved-workflows' });
    expect(response.statusCode).toBe(200);
    const body = savedWorkflowListResponseSchema.parse(response.json());
    const saved = body.items.find((item) => item.id === configurationId);
    expect(saved).toBeDefined();
    expect(saved?.name).toBe('Daily fault triage');
    expect(saved?.workflowName).toBe('Account fault triage');
    expect(saved?.datasetCount).toBe(2);
    expect(saved?.mappingCount).toBe(4);
    expect(saved?.ruleSet?.ruleCount).toBe(7);
    expect(saved?.lastRun).toBeNull();
    expect(saved?.runCount).toBe(0);
  });

  it('exposes the remembered recipe on the detail endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/saved-workflows/${configurationId}`,
    });
    expect(response.statusCode).toBe(200);
    const detail = savedWorkflowDetailDtoSchema.parse(response.json());
    expect(detail.configuration.id).toBe(configurationId);
    expect(detail.ruleSetDefinition?.rules).toHaveLength(7);
    expect(detail.configuration.mappings.map((mapping) => mapping.role)).toContain(
      'eventsTimestamp',
    );
    expect(detail.recentRuns).toEqual([]);
  });

  it('reports the latest run status, records and review count on the dashboard', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { configurationId },
    });
    expect(created.statusCode).toBe(202);
    const run = await waitForRun(app, runDtoSchema.parse(created.json()).id);
    expect(run.status).toBe('succeeded');

    const body = savedWorkflowListResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/saved-workflows' })).json(),
    );
    const saved = body.items.find((item) => item.id === configurationId);
    expect(saved?.runCount).toBe(1);
    expect(saved?.lastRun?.id).toBe(run.id);
    expect(saved?.lastRun?.status).toBe('succeeded');
    expect(saved?.lastRun?.recordsProcessed).toBe(9);
    expect(saved?.lastRun?.reviewItemCount).toBe(7);
    expect(saved?.lastRun?.openReviewItemCount).toBe(7);
    expect(saved?.lastRun?.exportStatus).toBe('pending_review');
    expect(saved?.lastRun?.exportReady).toBe(false);
  });

  it('previews carrying the saved mapping onto a new day of files', async () => {
    const nextPrimary = await uploadDataset(app, 'primary', 'primary_day2.csv', PRIMARY_CSV);
    const nextEvents = await uploadDataset(app, 'events', 'events_day2.csv', EVENTS_CSV);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/saved-workflows/${configurationId}/prepare`,
      payload: { assignments: assignmentsFor(nextPrimary, nextEvents) },
    });
    expect(response.statusCode).toBe(200);
    const prepared = prepareSavedWorkflowRunResponseSchema.parse(response.json());
    expect(prepared.valid).toBe(true);
    expect(prepared.plan.carried).toHaveLength(4);
    expect(prepared.plan.dropped).toEqual([]);
    expect(prepared.plan.datasetChanges).toHaveLength(2);
    expect(prepared.resolvedConfig?.['primaryAccountColumn']).toBe('Account Number');
  });

  it('runs again with a one-off rebind without changing the saved version', async () => {
    const nextPrimary = await uploadDataset(app, 'primary', 'primary_once.csv', PRIMARY_CSV);
    const nextEvents = await uploadDataset(app, 'events', 'events_once.csv', EVENTS_CSV);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/saved-workflows/${configurationId}/run`,
      payload: { assignments: assignmentsFor(nextPrimary, nextEvents), saveConfiguration: false },
    });
    expect(response.statusCode).toBe(202);
    const queued = runDtoSchema.parse(response.json());
    const run = await waitForRun(app, queued.id);
    expect(run.status).toBe('succeeded');
    expect(run.configurationId).toBe(configurationId);
    expect(run.snapshot?.configurationVersion).toBe(1);
    expect(run.snapshot?.ruleCount).toBe(7);

    // Reproducibility: the one-off run freezes the files it actually used, not the saved pointers.
    const snapshot = runSnapshotDtoSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/snapshot` })).json(),
    );
    expect(
      snapshot.configuration?.assignments.find((entry) => entry.role === 'primary')?.datasetId,
    ).toBe(nextPrimary.id);
    expect(snapshot.configuration?.version).toBe(1);

    const detail = savedWorkflowDetailDtoSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/saved-workflows/${configurationId}` })
      ).json(),
    );
    expect(detail.configurationVersion).toBe(1);
    expect(detail.runCount).toBe(2);
    expect(detail.recentRuns).toHaveLength(2);
  });

  it('persists the re-pointed mapping as a new version when asked', async () => {
    const nextPrimary = await uploadDataset(app, 'primary', 'primary_day3.csv', PRIMARY_CSV);
    const nextEvents = await uploadDataset(app, 'events', 'events_day3.csv', EVENTS_CSV);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/saved-workflows/${configurationId}/run`,
      payload: { assignments: assignmentsFor(nextPrimary, nextEvents), saveConfiguration: true },
    });
    expect(response.statusCode).toBe(202);
    const run = await waitForRun(app, runDtoSchema.parse(response.json()).id);
    expect(run.status).toBe('succeeded');
    expect(run.snapshot?.configurationVersion).toBe(2);

    const detail = savedWorkflowDetailDtoSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/saved-workflows/${configurationId}` })
      ).json(),
    );
    expect(detail.configurationVersion).toBe(2);
    expect(
      detail.configuration.assignments.find((entry) => entry.role === 'primary')?.datasetId,
    ).toBe(nextPrimary.id);
  });

  it('reports a blocking issue when a new file is missing a mapped column', async () => {
    const incompatiblePrimary = await uploadDataset(
      app,
      'primary',
      'renamed_primary.csv',
      'Reference,Label\nA-1,Alpha\nA-2,Beta\n',
    );
    const nextEvents = await uploadDataset(app, 'events', 'events_day4.csv', EVENTS_CSV);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/saved-workflows/${configurationId}/prepare`,
      payload: { assignments: assignmentsFor(incompatiblePrimary, nextEvents) },
    });
    expect(response.statusCode).toBe(200);
    const prepared = prepareSavedWorkflowRunResponseSchema.parse(response.json());
    expect(prepared.valid).toBe(false);
    expect(prepared.plan.dropped).toContainEqual(
      expect.objectContaining({ role: 'primaryEntityKey', reason: 'column_not_found' }),
    );
    expect(prepared.issues).toContainEqual(
      expect.objectContaining({ code: 'missing_required_column', role: 'primaryEntityKey' }),
    );
  });

  it('refuses to start a run when the attached files do not match the saved mapping', async () => {
    const incompatiblePrimary = await uploadDataset(
      app,
      'primary',
      'renamed_primary_2.csv',
      'Reference,Label\nA-1,Alpha\nA-2,Beta\n',
    );
    const nextEvents = await uploadDataset(app, 'events', 'events_day5.csv', EVENTS_CSV);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/saved-workflows/${configurationId}/run`,
      payload: { assignments: assignmentsFor(incompatiblePrimary, nextEvents) },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('invalid_configuration');
  });

  it('returns 404 for an unknown saved workflow', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/saved-workflows/missing' });
    expect(response.statusCode).toBe(404);
  });
});
