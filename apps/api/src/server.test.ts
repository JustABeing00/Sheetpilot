import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  type FileAssetDto,
  type HealthResponse,
  type MetaResponse,
  type ReviewItemDto,
  type RunDto,
  fileAssetDtoSchema,
  runDtoSchema,
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
  const boundary = '----sheetpilot-test-boundary';
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

async function uploadFile(
  app: FastifyInstance,
  options: { kind: string; filename: string; content: string; contentType?: string },
): Promise<FileAssetDto> {
  const { payload, contentType } = multipartPayload([
    { name: 'kind', value: options.kind },
    {
      name: 'file',
      filename: options.filename,
      value: options.content,
      contentType: options.contentType ?? 'text/csv',
    },
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
  const deadline = Date.now() + 10_000;
  for (;;) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` });
    expect(response.statusCode).toBe(200);
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

describe('SheetPilot API', () => {
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

  it('reports health', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.name).toBe('SheetPilot');
  });

  it('describes runtime capabilities', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(response.statusCode).toBe(200);
    const body = response.json<MetaResponse>();
    expect(body.repositoryDriver).toBe('memory');
    expect(body.storageDriver).toBe('memory');
    expect(body.aiProvider).toBe('noop');
    expect(body.capabilities.scheduler).toBe(false);
  });

  it('lists workflows with their rule sets', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/workflows' });
    expect(list.statusCode).toBe(200);
    const body = list.json<{ items: Array<{ slug: string; ruleCount: number }> }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.slug).toBe('account-fault-triage');
    expect(body.items[0]?.ruleCount).toBe(7);

    const detail = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/account-fault-triage',
    });
    expect(detail.statusCode).toBe(200);
    const workflow = detail.json<{ ruleSet: { rules: unknown[] }; steps: unknown[] }>();
    expect(workflow.ruleSet.rules).toHaveLength(7);
    expect(workflow.steps).toHaveLength(5);
  });

  it('returns 404 for unknown workflows', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/workflows/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found');
  });

  it('rejects unsupported upload formats', async () => {
    const { payload, contentType } = multipartPayload([
      { name: 'kind', value: 'generic' },
      {
        name: 'file',
        filename: 'notes.pdf',
        value: 'not a tabular file',
        contentType: 'application/pdf',
      },
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload,
      headers: { 'content-type': contentType },
    });
    expect(response.statusCode).toBe(415);
  });

  it('runs the end-to-end workflow from uploads to artifacts', async () => {
    const primary = await uploadFile(app, {
      kind: 'primary',
      filename: 'primary_accounts.csv',
      content: PRIMARY_CSV,
    });
    const events = await uploadFile(app, {
      kind: 'events',
      filename: 'fault_events.csv',
      content: EVENTS_CSV,
    });

    expect(primary.rowCount).toBe(10);
    expect(primary.columnNames).toContain('Account Number');
    expect(events.rowCount).toBe(13);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: {
        workflowSlug: 'account-fault-triage',
        primaryFileId: primary.id,
        eventsFileId: events.id,
      },
    });
    expect(created.statusCode).toBe(202);
    const queued = runDtoSchema.parse(created.json());
    expect(['queued', 'running', 'succeeded']).toContain(queued.status);

    const run = await waitForRun(app, queued.id);
    expect(run.status).toBe('succeeded');
    expect(run.error).toBeNull();
    expect(run.stats['accounts']).toBe(9);
    expect(run.stats['reviewAccounts']).toBe(7);
    expect(run.reviewItemCount).toBe(7);
    expect(run.openReviewItemCount).toBe(7);
    expect(run.steps.map((step) => step.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);

    const artifacts = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/artifacts` });
    expect(artifacts.statusCode).toBe(200);
    const artifactBody = artifacts.json<{
      items: Array<{ id: string; kind: string; format: string; downloadUrl: string }>;
    }>();
    expect(artifactBody.items.map((artifact) => artifact.kind).sort()).toEqual([
      'output_csv',
      'output_xlsx',
      'review_queue_csv',
    ]);

    const csvArtifact = artifactBody.items.find((artifact) => artifact.kind === 'output_csv');
    expect(csvArtifact).toBeDefined();
    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/artifacts/${csvArtifact!.id}/download`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('text/csv');

    const csv = download.body;
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('RootCause');
    const northRidge = lines.find((line) => line.startsWith('"1001"'));
    expect(northRidge).toContain('Power Loss');
    expect(northRidge).toContain('AUTO_APPROVED');

    const xlsxArtifact = artifactBody.items.find((artifact) => artifact.kind === 'output_xlsx');
    const xlsxDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/artifacts/${xlsxArtifact!.id}/download`,
    });
    expect(xlsxDownload.statusCode).toBe(200);
    expect(xlsxDownload.rawPayload.length).toBeGreaterThan(0);

    const decisions = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/decisions` });
    const decisionBody = decisions.json<{ items: Array<{ entityKey: string }>; total: number }>();
    expect(decisionBody.total).toBe(9);

    const reviewItems = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.id}/review-items`,
    });
    const reviewBody = reviewItems.json<{ items: ReviewItemDto[]; openCount: number }>();
    expect(reviewBody.items).toHaveLength(7);
    expect(reviewBody.openCount).toBe(7);
    expect(reviewBody.items.some((item) => item.reason === 'duplicate_primary_key')).toBe(true);

    const globalQueue = await app.inject({
      method: 'GET',
      url: '/api/v1/review-items?status=open',
    });
    expect(globalQueue.statusCode).toBe(200);
    const queueBody = globalQueue.json<{ items: ReviewItemDto[]; openCount: number }>();
    expect(queueBody.openCount).toBe(7);
    expect(queueBody.items[0]?.workflowSlug).toBe('account-fault-triage');

    const target = reviewBody.items.find((item) => item.entityKey === '1003');
    expect(target).toBeDefined();

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/review-items/${target!.id}/resolve`,
      payload: {
        action: 'overridden',
        values: { RootCause: 'Power Loss' },
        note: 'checked manually',
      },
    });
    expect(resolved.statusCode).toBe(200);
    const resolvedItem = resolved.json<ReviewItemDto>();
    expect(resolvedItem.status).toBe('resolved_overridden');
    expect(resolvedItem.resolution?.values['RootCause']).toBe('Power Loss');

    const secondAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/review-items/${target!.id}/resolve`,
      payload: { action: 'accepted' },
    });
    expect(secondAttempt.statusCode).toBe(409);

    const remaining = await app.inject({ method: 'GET', url: '/api/v1/review-items?status=open' });
    expect(remaining.json<{ openCount: number }>().openCount).toBe(6);

    const runs = await app.inject({ method: 'GET', url: '/api/v1/runs' });
    expect(runs.statusCode).toBe(200);
    expect(runs.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('validates run creation requests', async () => {
    const missingFiles = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { workflowSlug: 'account-fault-triage' },
    });
    expect(missingFiles.statusCode).toBe(400);

    const unknownFile = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: {
        workflowSlug: 'account-fault-triage',
        primaryFileId: 'missing-primary',
        eventsFileId: 'missing-events',
      },
    });
    expect(unknownFile.statusCode).toBe(404);
  });

  it('returns 404 for unknown runs and artifacts', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/runs/unknown' })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/artifacts/unknown/download' })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/nope' })).statusCode).toBe(404);
  });
});
