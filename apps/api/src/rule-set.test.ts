import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  datasetDtoSchema,
  decisionListResponseSchema,
  ruleSetDtoSchema,
  ruleSetListResponseSchema,
  ruleSetValidationResponseSchema,
  runDtoSchema,
  type DatasetDto,
  type RuleSetDto,
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
  const boundary = '----sheetpilot-rules-boundary';
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

const SENTINEL_RULES = [
  {
    id: 'sentinel-power',
    name: 'Sentinel power rule',
    priority: 999,
    when: {
      mode: 'any',
      conditions: [{ field: 'description', operator: 'contains', value: 'no power' }],
    },
    then: [
      { field: 'RootCause', value: 'Sentinel Root Cause' },
      { field: 'FaultCategory', value: 'Power' },
      { field: 'RecommendedAction', value: 'Sentinel action' },
      { field: 'Priority', value: 'P1' },
    ],
    confidence: 0.99,
    explanationTemplate: 'Sentinel matched "{matchedTerm}".',
  },
];

describe('rule set management API', () => {
  let app: FastifyInstance;
  let container: AppContainer;
  let primary: DatasetDto;
  let events: DatasetDto;
  let custom: RuleSetDto;

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

  it('lists the seeded active rule set for a workflow', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/rule-sets?workflowSlug=account-fault-triage',
    });
    expect(response.statusCode).toBe(200);
    const body = ruleSetListResponseSchema.parse(response.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.active).toBe(true);
    expect(body.items[0]?.ruleCount).toBe(7);
  });

  it('validates rules and reports blocking issues before saving', async () => {
    const good = await app.inject({
      method: 'POST',
      url: '/api/v1/rule-sets/validate',
      payload: { workflowSlug: 'account-fault-triage', rules: SENTINEL_RULES },
    });
    expect(good.statusCode).toBe(200);
    expect(ruleSetValidationResponseSchema.parse(good.json()).valid).toBe(true);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/rule-sets/validate',
      payload: {
        workflowSlug: 'account-fault-triage',
        rules: [
          {
            id: 'broken',
            name: 'Broken',
            when: { conditions: [{ field: 'description', operator: 'contains' }] },
            then: [{ field: 'RootCause', value: 'x' }],
          },
        ],
      },
    });
    expect(bad.statusCode).toBe(200);
    const badBody = ruleSetValidationResponseSchema.parse(bad.json());
    expect(badBody.valid).toBe(false);
    expect(badBody.issues.some((issue) => issue.level === 'error')).toBe(true);
  });

  it('refuses to save an invalid rule set', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rule-sets',
      payload: {
        workflowSlug: 'account-fault-triage',
        name: 'Invalid',
        rules: [
          {
            id: 'broken',
            name: 'Broken',
            when: {
              conditions: [{ field: 'description', operator: 'matches_regex', value: '([' }],
            },
            then: [{ field: 'RootCause', value: 'x' }],
          },
        ],
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('invalid_rule_set');
  });

  it('creates a versioned rule set and deactivates the previous one', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rule-sets',
      payload: {
        workflowSlug: 'account-fault-triage',
        name: 'Sentinel rules',
        rules: SENTINEL_RULES,
      },
    });
    expect(created.statusCode).toBe(201);
    custom = ruleSetDtoSchema.parse(created.json());
    expect(custom.version).toBe(1);
    expect(custom.active).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/rule-sets?workflowSlug=account-fault-triage',
    });
    const body = ruleSetListResponseSchema.parse(list.json());
    expect(body.items.filter((item) => item.active)).toHaveLength(1);
    expect(body.items.find((item) => item.active)?.id).toBe(custom.id);
  });

  it('updates a rule set with a version bump', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/rule-sets/${custom.id}`,
      payload: {
        name: 'Sentinel rules v2',
        rules: [{ ...SENTINEL_RULES[0]!, confidence: 0.5 }],
      },
    });
    expect(response.statusCode).toBe(200);
    const updated = ruleSetDtoSchema.parse(response.json());
    expect(updated.version).toBe(2);
    expect(updated.name).toBe('Sentinel rules v2');
  });

  it('uses the active rule set when a run executes', async () => {
    const runResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: {
        workflowSlug: 'account-fault-triage',
        primaryFileId: primary.fileId,
        eventsFileId: events.fileId,
      },
    });
    expect(runResponse.statusCode).toBe(202);
    const queued = runDtoSchema.parse(runResponse.json());
    const run = await waitForRun(app, queued.id);
    expect(run.status).toBe('succeeded');

    const decisionsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.id}/decisions?limit=200`,
    });
    expect(decisionsResponse.statusCode).toBe(200);
    const decisions = decisionListResponseSchema.parse(decisionsResponse.json());
    const account = decisions.items.find((item) => item.entityKey === '1001');
    expect(account?.matchedRuleIds).toEqual(['sentinel-power']);
    expect(account?.outputValues['RootCause']).toBe('Sentinel Root Cause');
  });

  it('returns 404 for unknown rule sets', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/rule-sets/missing' });
    expect(response.statusCode).toBe(404);
  });
});
