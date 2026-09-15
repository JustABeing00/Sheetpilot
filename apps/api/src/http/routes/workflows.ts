import { workflowListResponseSchema } from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { toWorkflowDetailDto, toWorkflowSummaryDto } from '../dto.js';

export function registerWorkflowRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/api/v1/workflows', () =>
    workflowListResponseSchema.parse({
      items: container.registry.list().map(toWorkflowSummaryDto),
    }),
  );

  app.get('/api/v1/workflows/:slug', (request) => {
    const { slug } = request.params as { slug: string };
    return toWorkflowDetailDto(container.registry.require(slug));
  });
}
