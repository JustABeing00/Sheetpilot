import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  decisionListResponseSchema,
  reviewHistoryResponseSchema,
  reviewItemDtoSchema,
  reviewQueueResponseSchema,
  runDtoSchema,
  type FileAssetDto,
  type ReviewItemDto,
  type RunDto,
} from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';
import { PRIMARY_CSV, EVENTS_CSV } from './fixtures.js';

function multipartPayload(
  parts: Array<{ name: string; value: string; filename?: string; contentType?: string }>,
): {
  payload: Buffer;
  contentType: string;
} {
  const boundary = '----sheetpilot-review-boundary';
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
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` });
    const run = runDtoSchema.parse(response.json());
    if (run.status === 'succeeded' || run.status === 'failed') {
      return run;
    }
    if (Date.now() > deadline) {
      throw new Error(`Run ${runId} did not finish (last: ${run.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('review queue & human-in-the-loop API', () => {
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
    run = await waitForRun(app, queued.id);
    expect(run.status).toBe('succeeded');
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('exposes filter presets, per-filter counts and a rich record shape', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/review-items?filter=needs_review',
    });
    expect(response.statusCode).toBe(200);
    const body = reviewQueueResponseSchema.parse(response.json());
    expect(body.items.length).toBe(7);
    expect(body.counts.needsReview).toBe(7);
    expect(body.counts.open).toBe(7);
    expect(body.counts.conflicts).toBeGreaterThan(0);

    const first = body.items[0]!;
    expect(first.state).toBe('NEEDS_REVIEW');
    expect(first.automation.decisionSource).toBeDefined();
    expect(Array.isArray(first.automation.applicableRules)).toBe(true);
    expect(first.latestEvent).not.toBeUndefined();
  });

  it('filters by conflict, low-confidence and processing-error presets', async () => {
    const conflicts = reviewQueueResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/review-items?filter=conflicts' })).json(),
    );
    expect(conflicts.items.length).toBeGreaterThan(0);
    expect(
      conflicts.items.every((item) =>
        ['rule_conflict', 'conflicting_fault_history', 'ambiguous_latest_timestamp'].includes(
          item.reason,
        ),
      ),
    ).toBe(true);

    const low = reviewQueueResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: '/api/v1/review-items?filter=low_confidence' })
      ).json(),
    );
    expect(
      low.items.every((item) => ['low_confidence', 'ai_low_confidence'].includes(item.reason)),
    ).toBe(true);

    const errors = reviewQueueResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: '/api/v1/review-items?filter=processing_errors' })
      ).json(),
    );
    expect(errors.items.every((item) => item.reason === 'ai_failed')).toBe(true);
  });

  it('records an override with a full audit trail, regeneration and decision state', async () => {
    const queue = reviewQueueResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/review-items?filter=needs_review' })).json(),
    );
    const target = queue.items.find((item) => Object.keys(item.suggestedValues).length > 0);
    expect(target).toBeDefined();
    const entity = target!.entityKey;
    const automationRootCause = target!.automation.values['RootCause'];

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/review-items/${target!.id}/resolve`,
      payload: {
        action: 'overridden',
        values: { RootCause: 'Manual Review Root Cause', Priority: 'Critical' },
        note: 'confirmed with the account owner',
      },
    });
    expect(resolved.statusCode).toBe(200);
    const resolvedItem = reviewItemDtoSchema.parse(resolved.json());
    expect(resolvedItem.state).toBe('OVERRIDDEN');
    expect(resolvedItem.resolution?.values['RootCause']).toBe('Manual Review Root Cause');
    expect(resolvedItem.resolution?.changedFields).toContain('RootCause');

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/review-items/${target!.id}/history`,
    });
    expect(history.statusCode).toBe(200);
    const historyBody = reviewHistoryResponseSchema.parse(history.json());
    expect(historyBody.items).toHaveLength(1);
    const entry = historyBody.items[0]!;
    expect(entry.previousStatus).toBe('open');
    expect(entry.resultingState).toBe('OVERRIDDEN');
    expect(entry.automation.values['RootCause']).toBe(automationRootCause);
    expect(entry.appliedValues['RootCause']).toBe('Manual Review Root Cause');
    expect(entry.changedFields).toContain('RootCause');
    expect(entry.note).toBe('confirmed with the account owner');

    // The generated output now matches the reviewed decision.
    const artifacts = (
      await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/artifacts` })
    ).json<{ items: Array<{ id: string; kind: string }> }>();
    const csv = artifacts.items.find((artifact) => artifact.kind === 'output_csv');
    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/artifacts/${csv!.id}/download`,
    });
    const line = download.body.split('\n').find((row) => row.startsWith(`"${entity}"`));
    expect(line).toBeDefined();
    expect(line).toContain('Manual Review Root Cause');
    expect(line).toContain('OVERRIDDEN');

    // The decision log reflects the human resolution without rewriting the automation source.
    const decisions = decisionListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/decisions?limit=200` })
      ).json(),
    );
    const decision = decisions.items.find((item) => item.entityKey === entity);
    expect(decision?.reviewState).toBe('OVERRIDDEN');
    expect(decision?.decisionSource).not.toBe('none');
  });

  it('accepts an item without explicit values by keeping the automation result', async () => {
    const queue = reviewQueueResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/review-items?filter=needs_review' })).json(),
    );
    const target = queue.items.find((item) => Object.keys(item.suggestedValues).length > 0);
    expect(target).toBeDefined();

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/review-items/${target!.id}/resolve`,
      payload: { action: 'accepted' },
    });
    const item = reviewItemDtoSchema.parse(resolved.json());
    expect(item.state).toBe('APPROVED');
    expect(item.resolution?.values).toEqual(target!.suggestedValues);
    expect(item.resolution?.changedFields).toEqual([]);
  });

  it('rejects double resolution and unknown items', async () => {
    const queue = reviewQueueResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/review-items?filter=needs_review' })).json(),
    );
    const target = queue.items[0]!;
    await app.inject({
      method: 'POST',
      url: `/api/v1/review-items/${target.id}/resolve`,
      payload: { action: 'dismissed' },
    });
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/review-items/${target.id}/resolve`,
      payload: { action: 'accepted' },
    });
    expect(again.statusCode).toBe(409);

    expect((await app.inject({ method: 'GET', url: '/api/v1/review-items/nope' })).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/review-items/nope/history' })).statusCode,
    ).toBe(404);
  });

  it('shows resolved, overridden and auto-resolved states together', async () => {
    const overridden = reviewQueueResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/review-items?filter=overridden' })).json(),
    );
    expect(overridden.items.some((item: ReviewItemDto) => item.state === 'OVERRIDDEN')).toBe(true);

    const decisions = decisionListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/decisions?limit=200` })
      ).json(),
    );
    expect(decisions.items.some((item) => item.reviewState === 'AUTO_RESOLVED')).toBe(true);
  });
});
