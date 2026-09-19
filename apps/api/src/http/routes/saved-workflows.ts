import {
  prepareSavedWorkflowRunRequestSchema,
  prepareSavedWorkflowRunResponseSchema,
  runDtoSchema,
  runSavedWorkflowRequestSchema,
  savedWorkflowDetailDtoSchema,
  savedWorkflowListResponseSchema,
} from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { toSavedWorkflowDetailDto, toSavedWorkflowSummaryDto } from '../dto.js';
import { parseOrThrow, tenantOf } from '../http-utils.js';
import { describeRun } from './runs.js';

export function registerSavedWorkflowRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/api/v1/saved-workflows', async (request) => {
    const items = await container.savedWorkflowService.list(200, tenantOf(request));
    return savedWorkflowListResponseSchema.parse({
      items: items.map(toSavedWorkflowSummaryDto),
    });
  });

  app.get('/api/v1/saved-workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    const detail = await container.savedWorkflowService.getById(id, tenantOf(request));
    return savedWorkflowDetailDtoSchema.parse(toSavedWorkflowDetailDto(detail));
  });

  app.post('/api/v1/saved-workflows/:id/prepare', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(
      prepareSavedWorkflowRunRequestSchema,
      request.body,
      'prepare saved workflow run request',
    );
    const result = await container.savedWorkflowService.prepare(
      id,
      body.assignments,
      tenantOf(request),
    );
    return prepareSavedWorkflowRunResponseSchema.parse(result);
  });

  app.post('/api/v1/saved-workflows/:id/run', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(
      runSavedWorkflowRequestSchema,
      request.body,
      'run saved workflow request',
    );
    const run = await container.savedWorkflowService.run(id, body, tenantOf(request));
    reply.status(202);
    return runDtoSchema.parse(await describeRun(container, run, true));
  });
}
