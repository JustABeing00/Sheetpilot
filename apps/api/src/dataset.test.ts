import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  datasetDtoSchema,
  datasetListResponseSchema,
  datasetRowsResponseSchema,
  type DatasetDto,
} from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';
import { PRIMARY_CSV } from './fixtures.js';

interface MultipartPart {
  name: string;
  value: string;
  filename?: string;
  contentType?: string;
}

function multipartPayload(parts: MultipartPart[]): { payload: Buffer; contentType: string } {
  const boundary = '----sheetpilot-dataset-boundary';
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

async function startApp(
  env: Record<string, string>,
): Promise<{ app: FastifyInstance; container: AppContainer }> {
  const config = loadConfig({
    NODE_ENV: 'test',
    REPOSITORY_DRIVER: 'memory',
    LOG_LEVEL: 'silent',
    ...env,
  });
  const container = await createContainer(config, CapturingLogger.create(), {
    storage: new InMemoryFileStorage(),
  });
  const app = buildServer(container, { startedAt: Date.now() });
  await app.ready();
  return { app, container };
}

async function uploadDataset(
  app: FastifyInstance,
  options: { filename: string; content: string; contentType?: string; kind?: string },
): Promise<DatasetDto> {
  const { payload, contentType } = multipartPayload([
    { name: 'kind', value: options.kind ?? 'generic' },
    {
      name: 'file',
      filename: options.filename,
      value: options.content,
      contentType: options.contentType ?? 'text/csv',
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

describe('dataset ingestion API', () => {
  let app: FastifyInstance;
  let container: AppContainer;

  beforeAll(async () => {
    ({ app, container } = await startApp({}));
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('uploads, inspects and lists a CSV dataset', async () => {
    const dataset = await uploadDataset(app, {
      filename: 'primary_accounts.csv',
      content: PRIMARY_CSV,
      kind: 'primary',
    });

    expect(dataset.originalName).toBe('primary_accounts.csv');
    expect(dataset.id).not.toBe(dataset.originalName);
    expect(dataset.fileId.length).toBeGreaterThan(0);
    expect(dataset.format).toBe('csv');
    expect(dataset.kind).toBe('primary');
    expect(dataset.rowCount).toBe(10);
    expect(dataset.rowCountExact).toBe(true);
    expect(dataset.truncated).toBe(false);
    expect(dataset.columns.map((column) => column.name)).toContain('Account Number');
    expect(dataset.sampleRows.length).toBeGreaterThan(0);
    expect(dataset.rowPreviewUrl).toContain(dataset.id);

    const list = await app.inject({ method: 'GET', url: '/api/v1/datasets' });
    expect(list.statusCode).toBe(200);
    const listBody = datasetListResponseSchema.parse(list.json());
    expect(listBody.items.map((item) => item.id)).toContain(dataset.id);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/datasets/${dataset.id}` });
    expect(detail.statusCode).toBe(200);
    expect(datasetDtoSchema.parse(detail.json()).id).toBe(dataset.id);
  });

  it('pages rows without loading the whole dataset', async () => {
    const dataset = await uploadDataset(app, {
      filename: 'primary_accounts.csv',
      content: PRIMARY_CSV,
    });

    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/datasets/${dataset.id}/rows?limit=2&offset=0`,
    });
    expect(first.statusCode).toBe(200);
    const firstPage = datasetRowsResponseSchema.parse(first.json());
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(10);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.columns).toContain('Account Number');

    const last = await app.inject({
      method: 'GET',
      url: `/api/v1/datasets/${dataset.id}/rows?limit=2&offset=8`,
    });
    const lastPage = datasetRowsResponseSchema.parse(last.json());
    expect(lastPage.items).toHaveLength(2);
    expect(lastPage.hasMore).toBe(false);
  });

  it('re-analyzes a specific sheet on demand', async () => {
    const dataset = await uploadDataset(app, {
      filename: 'primary_accounts.csv',
      content: PRIMARY_CSV,
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/datasets/${dataset.id}/analysis`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ datasetId: string; analysis: { columns: unknown[] } }>();
    expect(body.datasetId).toBe(dataset.id);
    expect(body.analysis.columns.length).toBe(dataset.columns.length);
  });

  it('never trusts the uploaded filename', async () => {
    const dataset = await uploadDataset(app, {
      filename: '..\\..\\windows\\evil.csv',
      content: PRIMARY_CSV,
    });
    expect(dataset.originalName).toBe('evil.csv');
  });

  it('rejects unsupported, legacy, empty, corrupt and unknown datasets', async () => {
    const pdf = multipartPayload([
      { name: 'kind', value: 'generic' },
      { name: 'file', filename: 'notes.pdf', value: 'pdf', contentType: 'application/pdf' },
    ]);
    const pdfResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/datasets',
      payload: pdf.payload,
      headers: { 'content-type': pdf.contentType },
    });
    expect(pdfResponse.statusCode).toBe(415);
    expect(pdfResponse.json<{ error: { code: string } }>().error.code).toBe('unsupported_format');

    const legacy = multipartPayload([
      { name: 'kind', value: 'generic' },
      {
        name: 'file',
        filename: 'legacy.xls',
        value: 'old',
        contentType: 'application/vnd.ms-excel',
      },
    ]);
    const legacyResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/datasets',
      payload: legacy.payload,
      headers: { 'content-type': legacy.contentType },
    });
    expect(legacyResponse.statusCode).toBe(415);

    const empty = multipartPayload([
      { name: 'kind', value: 'generic' },
      { name: 'file', filename: 'empty.csv', value: 'A,B\n', contentType: 'text/csv' },
    ]);
    const emptyResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/datasets',
      payload: empty.payload,
      headers: { 'content-type': empty.contentType },
    });
    expect(emptyResponse.statusCode).toBe(422);
    expect(emptyResponse.json<{ error: { code: string } }>().error.code).toBe('empty_dataset');

    const corrupt = multipartPayload([
      { name: 'kind', value: 'generic' },
      {
        name: 'file',
        filename: 'broken.xlsx',
        value: 'not a workbook',
        contentType: 'application/octet-stream',
      },
    ]);
    const corruptResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/datasets',
      payload: corrupt.payload,
      headers: { 'content-type': corrupt.contentType },
    });
    expect(corruptResponse.statusCode).toBe(422);
    expect(corruptResponse.json<{ error: { code: string } }>().error.code).toBe('corrupt_file');

    const missing = await app.inject({ method: 'GET', url: '/api/v1/datasets/unknown' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('dataset upload limits', () => {
  let app: FastifyInstance;
  let container: AppContainer;

  beforeAll(async () => {
    ({ app, container } = await startApp({ MAX_UPLOAD_MB: '0.1' }));
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('rejects files above the configured size limit', async () => {
    const oversized = `name,value\n${'x'.repeat(200_000)}`;
    const { payload, contentType } = multipartPayload([
      { name: 'kind', value: 'generic' },
      { name: 'file', filename: 'huge.csv', value: oversized, contentType: 'text/csv' },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/datasets',
      payload,
      headers: { 'content-type': contentType },
    });

    expect(response.statusCode).toBe(413);
  });
});
