import { APP_NAME, APP_VERSION, healthResponseSchema, type Clock } from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(
  app: FastifyInstance,
  options: { clock: Clock; startedAt: number; readiness: () => Promise<void> },
): void {
  app.get('/healthz', () => {
    const now = options.clock.now();
    return healthResponseSchema.parse({
      status: 'ok',
      name: APP_NAME,
      version: APP_VERSION,
      uptimeSeconds: Math.max(0, (now.getTime() - options.startedAt) / 1000),
      now: now.toISOString(),
    });
  });

  // Readiness is separate from liveness: it proves the backing store answers, so an orchestrator does
  // not route traffic to an instance whose database is unreachable or whose schema is missing.
  app.get('/readyz', async (_request, reply) => {
    try {
      await options.readiness();
      return { status: 'ready', name: APP_NAME, version: APP_VERSION };
    } catch (error) {
      return reply.status(503).send({
        status: 'not_ready',
        name: APP_NAME,
        version: APP_VERSION,
        reason: error instanceof Error ? error.message : 'readiness check failed',
      });
    }
  });
}
