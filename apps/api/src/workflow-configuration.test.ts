import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  configurationValidationResponseSchema,
  datasetDtoSchema,
  runDtoSchema,
  workflowConfigurationDtoSchema,
  workflowConfigurationListResponseSchema,
  workflowDetailDtoSchema,
  type DatasetDto,
  type RunDto,
} from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';
import { PRIMARY_CSV, EVENTS_CSV } from './fixtures.js';

interface MultipartPart {
  name: string;
  value: string;
  filename?: string;
  contentType?: string;
}

function multipartPayload(parts: MultipartPart[]): { payload: Buffer; contentType: string } {
  const boundary = '----sheetpilot-config-boundary';
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
  options: { filename: string; content: string; kind: string },
): Promise<DatasetDto> {
  const { payload, contentType } = multipartPayload([
    { name: 'kind', value: options.kind },
    {
      name: 'file',
      filename: options.filename,
      value: options.content,
      contentType: 'text/csv',
    },
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
  const deadline = Date.now() + 10_000;
  for (;;) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` });
    const run = runDtoSchema.parse(response.json());
    if (run.status === 'succeeded' || run.status === 'failed') {
      return run;
    }
    if (Date.now() > deadline) {
      throw new Error(`Run ${runId} did not finish in time (last status: ${run.status})`);
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

describe('workflow configuration API', () => {
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
    primary = await uploadDataset(app, {
      filename: 'primary_accounts.csv',
      content: PRIMARY_CSV,
      kind: 'primary',
    });
    events = await uploadDataset(app, {
      filename: 'fault_events.csv',
      content: EVENTS_CSV,
      kind: 'events',
    });
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('exposes the workflow configuration definition to the UI', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/account-fault-triage',
    });
    expect(response.statusCode).toBe(200);
    const body = workflowDetailDtoSchema.parse(response.json());
    expect(body.configuration.datasetRoles.map((role) => role.key)).toEqual(['primary', 'events']);
    expect(body.configuration.columnRoles.map((role) => role.key)).toContain('eventsTimestamp');
    expect(body.configuration.options.map((option) => option.key)).toContain(
      'reviewBelowConfidence',
    );
  });

  it('validates an incomplete configuration and reports blocking issues', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-configurations/validate',
      payload: {
        workflowSlug: 'account-fault-triage',
        assignments: assignmentsFor(primary, events),
        mappings: mappingsFor(primary, events).filter(
          (mapping) => mapping.role !== 'eventsTimestamp',
        ),
        options: { reviewBelowConfidence: 0.8 },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = configurationValidationResponseSchema.parse(response.json());
    expect(body.valid).toBe(false);
    expect(body.issues).toContainEqual(
      expect.objectContaining({ code: 'missing_required_column', role: 'eventsTimestamp' }),
    );
    expect(body.resolvedConfig).toBeNull();
  });

  it('validates a complete configuration and previews the resolved run config', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-configurations/validate',
      payload: {
        workflowSlug: 'account-fault-triage',
        assignments: assignmentsFor(primary, events),
        mappings: mappingsFor(primary, events),
        options: { reviewBelowConfidence: 0.9 },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = configurationValidationResponseSchema.parse(response.json());
    expect(body.valid).toBe(true);
    expect(body.resolvedConfig?.['primaryAccountColumn']).toBe('Account Number');
    expect(body.resolvedConfig?.['eventsTimestampColumn']).toBe('Fault Date');
    expect(body.resolvedConfig?.['reviewBelowConfidence']).toBe(0.9);
  });

  it('refuses to save an invalid configuration', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-configurations',
      payload: {
        workflowSlug: 'account-fault-triage',
        name: 'Broken',
        assignments: assignmentsFor(primary, events),
        mappings: [],
        options: { reviewBelowConfidence: 0.8 },
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('invalid_configuration');
  });

  it('persists, lists, versions and runs a configuration', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-configurations',
      payload: {
        workflowSlug: 'account-fault-triage',
        name: 'Daily fault triage',
        description: 'Primary accounts + fault events',
        assignments: assignmentsFor(primary, events),
        mappings: mappingsFor(primary, events),
        options: { reviewBelowConfidence: 0.8, includeSystemColumns: true },
      },
    });
    expect(created.statusCode).toBe(201);
    const configuration = workflowConfigurationDtoSchema.parse(created.json());
    expect(configuration.version).toBe(1);
    expect(configuration.workflowSlug).toBe('account-fault-triage');
    expect(configuration.mappings).toHaveLength(4);

    const list = await app.inject({ method: 'GET', url: '/api/v1/workflow-configurations' });
    expect(list.statusCode).toBe(200);
    const listBody = workflowConfigurationListResponseSchema.parse(list.json());
    expect(listBody.items.map((item) => item.id)).toContain(configuration.id);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/workflow-configurations/${configuration.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ id: string }>().id).toBe(configuration.id);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/workflow-configurations/${configuration.id}`,
      payload: { options: { reviewBelowConfidence: 0.9, includeSystemColumns: true } },
    });
    expect(updated.statusCode).toBe(200);
    const updatedConfiguration = workflowConfigurationDtoSchema.parse(updated.json());
    expect(updatedConfiguration.version).toBe(2);
    expect(updatedConfiguration.options['reviewBelowConfidence']).toBe(0.9);

    const runResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { configurationId: configuration.id },
    });
    expect(runResponse.statusCode).toBe(202);
    const queued = runDtoSchema.parse(runResponse.json());
    expect(queued.configurationId).toBe(configuration.id);

    const run = await waitForRun(app, queued.id);
    expect(run.status).toBe('succeeded');
    expect(run.configurationId).toBe(configuration.id);
    expect(run.stats['accounts']).toBe(9);
    expect(run.config['primaryAccountColumn']).toBe('Account Number');
  });

  it('returns 404 for unknown configurations', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflow-configurations/missing',
    });
    expect(response.statusCode).toBe(404);
  });
});
