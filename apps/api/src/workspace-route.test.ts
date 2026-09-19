import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { CapturingLogger, isAppError, systemClock, toPublicErrorBody } from '@sheetpilot/core';
import { createInMemoryRepositories } from '@sheetpilot/db';
import type { AppContainer } from './container.js';
import './auth/types.js';
import { registerWorkspaceRoutes } from './http/routes/workspaces.js';
import { WorkspaceService } from './services/workspace-service.js';

async function buildApp(options: { authEnabled: boolean; service: WorkspaceService }) {
  const app = Fastify();
  await app.register(cookie);
  app.addHook('onRequest', (request, _reply, done) => {
    request.authUser = {
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
      tenantId: 'tenant-1',
    };
    done();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.status(error.statusCode).send(toPublicErrorBody(error));
      return;
    }
    reply.status(500).send({ error: { code: 'internal_error', message: 'unexpected' } });
  });
  const container = {
    auth: { enabled: options.authEnabled },
    config: { isProduction: false },
    workspaceService: options.service,
  } as unknown as AppContainer;
  registerWorkspaceRoutes(app, container);
  await app.ready();
  return app;
}

function makeService(): WorkspaceService {
  return new WorkspaceService({
    repositories: createInMemoryRepositories(),
    clock: systemClock,
    logger: CapturingLogger.create(),
  });
}

describe('workspace activation route', () => {
  it('validates the membership and remembers the workspace in an httpOnly cookie', async () => {
    const service = makeService();
    const workspace = await service.create('user-1', 'Alpha');
    const stranger = await service.create('user-2', 'Beta');
    const app = await buildApp({ authEnabled: true, service });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspace.id}/activate`,
    });
    expect(response.statusCode).toBe(204);
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toContain(`sp_workspace=${workspace.id}`);
    expect(setCookie).toContain('HttpOnly');

    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${stranger.id}/activate`,
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.headers['set-cookie']).toBeUndefined();
  });

  it('refuses to switch workspaces when authentication is disabled', async () => {
    const service = makeService();
    const workspace = await service.create('user-1', 'Alpha');
    const app = await buildApp({ authEnabled: false, service });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspace.id}/activate`,
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
