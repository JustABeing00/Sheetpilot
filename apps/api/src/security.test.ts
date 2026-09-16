import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapturingLogger,
  fileAssetDtoSchema,
  workflowRunSchema,
  type FileAssetDto,
  type RunDto,
} from '@sheetpilot/core';
import { loadConfig } from '@sheetpilot/config';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { createContainer, type AppContainer } from './container.js';
import { buildServer } from './server.js';
import { RetentionService } from './services/retention-service.js';
import { PRIMARY_CSV, EVENTS_CSV } from './fixtures.js';

interface MultipartPart {
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}

function multipartPayload(parts: MultipartPart[]): { payload: Buffer; contentType: string } {
  const boundary = '----sheetpilot-security-boundary';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        part.filename
          ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
          : `Content-Disposition: form-data; name="${part.name}"\r\n`,
      ),
    );
    if (part.contentType) {
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    }
    chunks.push(Buffer.from('\r\n'));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value, 'utf8'));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function startApp(
  env: Record<string, string> = {},
  storage = new InMemoryFileStorage(),
): Promise<{ app: FastifyInstance; container: AppContainer; storage: InMemoryFileStorage }> {
  const config = loadConfig({
    NODE_ENV: 'test',
    REPOSITORY_DRIVER: 'memory',
    LOG_LEVEL: 'silent',
    ...env,
  });
  const container = await createContainer(config, CapturingLogger.create(), { storage });
  const app = buildServer(container, { startedAt: Date.now() });
  await app.ready();
  return { app, container, storage };
}

async function uploadFile(
  app: FastifyInstance,
  options: { kind: string; filename: string; content: string },
): Promise<FileAssetDto> {
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
    url: '/api/v1/files',
    payload,
    headers: { 'content-type': contentType },
  });
  expect(response.statusCode).toBe(201);
  return fileAssetDtoSchema.parse(response.json());
}

/** Builds a ZIP central directory + EOCD describing a single enormous uncompressed entry. */
function zipBombBuffer(): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt32LE(50, 20);
  header.writeUInt32LE(500 * 1024 * 1024, 24);
  header.writeUInt16LE(name.length, 28);
  const directory = Buffer.concat([header, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([directory, eocd]);
}

describe('API security — authentication', () => {
  let app: FastifyInstance;
  let container: AppContainer;

  beforeAll(async () => {
    ({ app, container } = await startApp({ API_KEY: 'top-secret' }));
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('rejects requests without a key', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/workflows' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('unauthorized');
  });

  it('rejects a wrong key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { 'x-api-key': 'wrong' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts the correct key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { 'x-api-key': 'top-secret' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('keeps the health probe unauthenticated', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
  });
});

describe('API security — rate limiting and headers', () => {
  let app: FastifyInstance;
  let container: AppContainer;

  beforeAll(async () => {
    ({ app, container } = await startApp({
      RATE_LIMIT_MAX: '3',
      RATE_LIMIT_WINDOW_MS: '60000',
    }));
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('returns 429 with retry-after once the window budget is exhausted', async () => {
    for (let index = 0; index < 3; index += 1) {
      const ok = await app.inject({ method: 'GET', url: '/api/v1/workflows' });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: 'GET', url: '/api/v1/workflows' });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.json<{ error: { code: string } }>().error.code).toBe('rate_limited');
  });

  it('sets conservative response headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('API security — error hygiene', () => {
  let app: FastifyInstance;
  let container: AppContainer;

  beforeAll(async () => {
    ({ app, container } = await startApp({ RATE_LIMIT_MAX: '0' }));
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('does not leak stack traces in error bodies', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/runs/does-not-exist' });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: Record<string, unknown> }>();
    expect(body.error).toMatchObject({ code: 'not_found' });
    expect(body.error).not.toHaveProperty('stack');
  });

  it('rejects a malformed JSON body cleanly', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { 'content-type': 'application/json' },
      payload: '{"workflowSlug": ',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBeTruthy();
  });
});

describe('API reliability — idempotent run creation', () => {
  let app: FastifyInstance;
  let container: AppContainer;

  beforeAll(async () => {
    ({ app, container } = await startApp({ RATE_LIMIT_MAX: '0' }));
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('returns the same run for a replayed Idempotency-Key', async () => {
    const primary = await uploadFile(app, {
      kind: 'primary',
      filename: 'primary.csv',
      content: PRIMARY_CSV,
    });
    const events = await uploadFile(app, {
      kind: 'events',
      filename: 'events.csv',
      content: EVENTS_CSV,
    });

    const payload = {
      workflowSlug: 'account-fault-triage',
      primaryFileId: primary.id,
      eventsFileId: events.id,
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { 'idempotency-key': 'retry-1' },
      payload,
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { 'idempotency-key': 'retry-1' },
      payload,
    });
    expect(second.statusCode).toBe(202);
    expect(second.headers['idempotency-replayed']).toBe('true');

    const firstRun = first.json<RunDto>();
    const secondRun = second.json<RunDto>();
    expect(secondRun.id).toBe(firstRun.id);

    const list = await app.inject({ method: 'GET', url: '/api/v1/runs' });
    expect(list.json<{ items: RunDto[] }>().items).toHaveLength(1);
  });
});

describe('API reliability — stale run recovery', () => {
  let app: FastifyInstance;
  let container: AppContainer;

  beforeAll(async () => {
    ({ app, container } = await startApp({ RATE_LIMIT_MAX: '0' }));
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('fails a run stranded in running by a previous process', async () => {
    await container.repositories.runs.create(
      workflowRunSchema.parse({
        id: 'stale-run',
        workflowId: 'wf-account-fault-triage',
        workflowSlug: 'account-fault-triage',
        workflowVersion: 1,
        status: 'running',
        primaryFileId: 'primary',
        eventsFileId: 'events',
        configurationId: null,
        config: {},
        stats: {},
        error: null,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: null,
      }),
    );

    const result = await container.runService.recoverStaleRuns();
    expect(result.recovered).toBe(1);

    const recovered = await container.repositories.runs.getById('stale-run');
    expect(recovered?.status).toBe('failed');
    expect(recovered?.error).toContain('interrupted');
  });
});

describe('API file security — zip bombs and cleanup', () => {
  let app: FastifyInstance;
  let container: AppContainer;
  let storage: InMemoryFileStorage;

  beforeAll(async () => {
    ({ app, container, storage } = await startApp({ RATE_LIMIT_MAX: '0' }));
  });

  afterAll(async () => {
    await app.close();
    await container.close();
  });

  it('rejects a workbook that would expand enormously and stores nothing', async () => {
    const { payload, contentType } = multipartPayload([
      { name: 'kind', value: 'generic' },
      {
        name: 'file',
        filename: 'bomb.xlsx',
        value: zipBombBuffer(),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/datasets',
      payload,
      headers: { 'content-type': contentType },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('corrupt_file');
    expect(await storage.list('uploads/')).toHaveLength(0);
  });

  it('cleans up a stored upload when inspection fails', async () => {
    const { payload, contentType } = multipartPayload([
      { name: 'kind', value: 'generic' },
      {
        name: 'file',
        filename: 'header-only.csv',
        value: 'A,B\n',
        contentType: 'text/csv',
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/datasets',
      payload,
      headers: { 'content-type': contentType },
    });

    expect(response.statusCode).toBe(422);
    expect(await storage.list('uploads/')).toHaveLength(0);
  });
});

describe('RetentionService', () => {
  it('removes expired unreferenced uploads and keeps referenced ones', async () => {
    const storage = new InMemoryFileStorage({ clock: () => new Date(0) });
    await storage.put('uploads/csv/orphan.csv', Buffer.from('orphan'));
    await storage.put('uploads/csv/kept.csv', Buffer.from('kept'));

    const repositories = {
      files: { list: () => Promise.resolve([{ storageKey: 'uploads/csv/kept.csv' }]) },
    } as unknown as AppContainer['repositories'];

    const service = new RetentionService({
      storage,
      repositories,
      logger: CapturingLogger.create(),
      clock: { now: () => new Date() },
      uploadTtlMs: 1000,
      sweepIntervalMs: 60_000,
    });

    const result = await service.sweep();
    expect(result.removed).toBe(1);
    expect(result.removedKeys).toEqual(['uploads/csv/orphan.csv']);
    expect((await storage.list('uploads/')).map((item) => item.key)).toEqual([
      'uploads/csv/kept.csv',
    ]);
  });
});
