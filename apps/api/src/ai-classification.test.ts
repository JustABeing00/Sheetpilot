import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  decisionListResponseSchema,
  reviewItemListResponseSchema,
  runDtoSchema,
  type AiClassificationRequest,
  type AiClassificationResult,
  type ClassificationProvider,
} from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';
import { PRIMARY_CSV, EVENTS_CSV } from './fixtures.js';

class MockClassificationProvider implements ClassificationProvider {
  readonly id = 'mock';
  readonly displayName = 'Mock AI';
  readonly model = 'mock-1';

  isAvailable(): boolean {
    return true;
  }

  classify(_request: AiClassificationRequest): Promise<AiClassificationResult> {
    return Promise.resolve({
      proposedCode: 'SENSOR_FAULT',
      proposedLabel: 'Sensor Fault',
      confidence: 0.94,
      reasoning: 'The unknown telemetry anomaly most resembles a sensor fault.',
      ambiguity: [],
      missingInformation: [],
    });
  }
}

function multipart(
  kind: string,
  filename: string,
  content: string,
): { payload: Buffer; contentType: string } {
  const boundary = '----sheetpilot-ai-test';
  const body = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n`,
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`,
    `Content-Type: text/csv\r\n\r\n${content}\r\n`,
    `--${boundary}--\r\n`,
  ].join('');
  return {
    payload: Buffer.from(body, 'utf8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(app: FastifyInstance, kind: string, filename: string, content: string) {
  const { payload, contentType } = multipart(kind, filename, content);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/files',
    payload,
    headers: { 'content-type': contentType },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>();
}

async function waitForRun(app: FastifyInstance, runId: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` });
    const run = runDtoSchema.parse(response.json());
    if (run.status === 'succeeded' || run.status === 'failed') {
      return run;
    }
    if (Date.now() > deadline) {
      throw new Error(`Run ${runId} did not finish in time`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('AI-assisted classification API', () => {
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
      classifier: new MockClassificationProvider(),
    });
    app = buildServer(container, { startedAt: Date.now() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('records an auto-approved AI suggestion with full provenance', async () => {
    const primary = await upload(app, 'primary', 'primary_accounts.csv', PRIMARY_CSV);
    const events = await upload(app, 'events', 'fault_events.csv', EVENTS_CSV);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: {
        workflowSlug: 'account-fault-triage',
        primaryFileId: primary.id,
        eventsFileId: events.id,
        config: { aiPolicy: 'on_no_rule_match', aiAutoApprove: true, aiMinConfidence: 0.9 },
      },
    });
    expect(created.statusCode).toBe(202);
    const run = await waitForRun(app, runDtoSchema.parse(created.json()).id);
    expect(run.status).toBe('succeeded');

    const decisionsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.id}/decisions?limit=200`,
    });
    const decisions = decisionListResponseSchema.parse(decisionsResponse.json());
    const elmStreet = decisions.items.find((item) => item.entityKey === '1004');

    expect(elmStreet?.decisionSource).toBe('ai_suggested');
    expect(elmStreet?.aiAssisted).toBe(true);
    expect(elmStreet?.outputValues['RootCause']).toBe('Sensor Fault');
    expect(elmStreet?.ai).toMatchObject({
      status: 'suggested',
      model: 'mock-1',
      result: { proposedCode: 'SENSOR_FAULT', confidence: 0.94 },
    });

    const reviewResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/review-items?status=open&limit=200`,
    });
    const review = reviewItemListResponseSchema.parse(reviewResponse.json());
    expect(review.items.some((item) => item.entityKey === '1004')).toBe(false);
  });
});
