import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  datasetDtoSchema,
  exportStatusResponseSchema,
  fileAssetDtoSchema,
  runDtoSchema,
  type DatasetDto,
  type FileAssetDto,
  type RunDto,
} from '@sheetpilot/core';
import { createInMemoryRepositories } from '@sheetpilot/db';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { loadConfig } from '@sheetpilot/config';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';

const WORKFLOW = 'account-fault-triage';

function multipartPayload(
  parts: Array<{ name: string; value: string; filename?: string; contentType?: string }>,
): { payload: Buffer; contentType: string } {
  const boundary = '----sheetpilot-audit-boundary';
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
): Promise<{ status: number; body: DatasetDto | null }> {
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
  return {
    status: response.statusCode,
    body: response.statusCode === 201 ? datasetDtoSchema.parse(response.json()) : null,
  };
}

async function uploadFile(
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
  return fileAssetDtoSchema.parse(response.json());
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

describe('final QA audit — ingestion edge cases', () => {
  let app: FastifyInstance;
  let container: AppContainer;

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
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('rejects a zero-byte file', async () => {
    const { status } = await uploadDataset(app, 'generic', 'empty.csv', '');
    expect(status).toBe(400);
  });

  it('rejects a header-only file with no data rows', async () => {
    const { status } = await uploadDataset(
      app,
      'generic',
      'header-only.csv',
      'Account Number,Name\n',
    );
    expect(status).toBe(422);
  });

  it('ingests a file with duplicate columns and warns about it', async () => {
    const { status, body } = await uploadDataset(
      app,
      'generic',
      'duplicate-columns.csv',
      'Account Number,Name,Name\n00101,First,Second\n',
    );
    expect(status).toBe(201);
    expect(body?.columns.map((column) => column.name)).toEqual(['Account Number', 'Name']);
    expect(body?.warnings.some((warning) => warning.code === 'duplicate_column_names')).toBe(true);
  });

  it('preserves leading-zero identifiers and reports them as text', async () => {
    const { status, body } = await uploadDataset(
      app,
      'generic',
      'leading-zeros.csv',
      'Account Number,Value\n00123,alpha\n00456,beta\n',
    );
    expect(status).toBe(201);
    const account = body?.columns.find((column) => column.name === 'Account Number');
    expect(account?.type).toBe('string');
    expect(account?.likelyIdentifier).toBe(true);
    expect(account?.sampleValues).toContain('00123');
    expect(body?.warnings.some((warning) => warning.code === 'leading_zero_identifier')).toBe(true);
  });

  it('handles unusual characters, embedded commas and quotes', async () => {
    const { status, body } = await uploadDataset(
      app,
      'generic',
      'unicode.csv',
      'Account Number,Name\n00101,"Café — “quoted, name” ✓"\n00102,Plain\n',
    );
    expect(status).toBe(201);
    expect(body?.rowCount).toBe(2);
    const name = body?.columns.find((column) => column.name === 'Name');
    expect(name?.sampleValues.some((value) => value.includes('Café'))).toBe(true);
  });
});

describe('final QA audit — classification edge cases', () => {
  let app: FastifyInstance;
  let container: AppContainer;

  const PRIMARY = [
    'Account Number,Name,RootCause,FaultCategory,RecommendedAction,Priority',
    '00101,Acme,,,,',
    '00101,Acme,,,,',
    '00200,Globex,,,,',
    '00300,Initech,,,,',
    '',
  ].join('\n');

  const EVENTS = [
    'Account Number,Fault Date,Fault Description',
    '00101,2026-01-01T00:00:00Z,Power supply failure',
    '00101,2026-01-01T00:00:00Z,Power supply failure repeated',
    '00200,2026-01-05T00:00:00Z,Network timeout',
    '',
  ].join('\n');

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
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('handles duplicate primary keys, identical timestamps and a record with no events', async () => {
    const primary = await uploadFile(app, 'primary', 'primary.csv', PRIMARY);
    const events = await uploadFile(app, 'events', 'events.csv', EVENTS);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: {
        workflowSlug: WORKFLOW,
        primaryFileId: primary.id,
        eventsFileId: events.id,
        config: {},
      },
    });
    expect(created.statusCode).toBe(202);
    const run = await waitForRun(app, runDtoSchema.parse(created.json()).id);
    expect(run.status).toBe('succeeded');

    const decisions = (
      await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/decisions?limit=200` })
    ).json<{ items: Array<{ entityKey: string; reviewReasons: string[] }> }>();
    const reasonsFor = (key: string) =>
      decisions.items.find((decision) => decision.entityKey === key)?.reviewReasons ?? [];

    expect(reasonsFor('00101')).toContain('duplicate_primary_key');
    expect(reasonsFor('00101')).toContain('ambiguous_latest_timestamp');
    expect(reasonsFor('00300')).toContain('no_events');
    expect(reasonsFor('00200')).not.toContain('no_events');

    // Many-to-one: two primary rows for 00101 become one decision but two output rows.
    const status = exportStatusResponseSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/export` })).json(),
    );
    expect(status.summary.totalRecords).toBe(3);
    expect(status.summary.outputRows).toBe(4);
  });

  it('fails a run fast, with a helpful message, when a configured column is missing', async () => {
    const primary = await uploadFile(app, 'primary', 'primary2.csv', PRIMARY);
    const events = await uploadFile(app, 'events', 'events2.csv', EVENTS);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: {
        workflowSlug: WORKFLOW,
        primaryFileId: primary.id,
        eventsFileId: events.id,
        config: { eventsAccountColumn: 'Column That Does Not Exist' },
      },
    });
    expect(created.statusCode).toBe(202);
    const run = await waitForRun(app, runDtoSchema.parse(created.json()).id);
    expect(run.status).toBe('failed');
    // The error must name the missing column and list what is actually available, so the operator
    // can fix the mapping rather than guess.
    expect(run.error).toContain('Column That Does Not Exist');
    expect(run.error).toContain('Account Number');
  });
});

describe('final QA audit — startup seeding must not discard user rule sets', () => {
  it('keeps a customized active rule set across container restarts', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      REPOSITORY_DRIVER: 'memory',
      LOG_LEVEL: 'silent',
    });
    const repositories = createInMemoryRepositories();
    const storage = new InMemoryFileStorage();

    const first = await createContainer(config, CapturingLogger.create(), {
      storage,
      repositories,
    });
    const seeded = await first.ruleSetService.getActiveForWorkflow(WORKFLOW);
    expect(seeded).not.toBeNull();
    expect(seeded?.rules.length).toBe(7);

    const custom = await first.ruleSetService.create({
      workflowSlug: WORKFLOW,
      name: 'Operator customizations',
      rules: seeded!.rules.map((rule) => ({ ...rule, name: `Custom ${rule.name}` })),
      activate: true,
    });
    expect(custom.id).not.toBe(seeded!.id);

    // A restart (a second container over the same repositories) must leave the operator's set alone.
    const second = await createContainer(config, CapturingLogger.create(), {
      storage,
      repositories,
    });
    const activeAfter = await second.ruleSetService.getActiveForWorkflow(WORKFLOW);
    expect(activeAfter?.id).toBe(custom.id);
    expect(activeAfter?.name).toBe('Operator customizations');
    expect(activeAfter?.rules.every((rule) => rule.name.startsWith('Custom '))).toBe(true);

    await first.close();
    await second.close();
  });
});
