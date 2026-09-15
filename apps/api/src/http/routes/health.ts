import { APP_NAME, APP_VERSION, healthResponseSchema, type Clock } from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(
  app: FastifyInstance,
  options: { clock: Clock; startedAt: number },
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
}
