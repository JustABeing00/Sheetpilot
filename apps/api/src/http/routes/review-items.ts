import {
  resolveReviewItemRequestSchema,
  reviewItemListResponseSchema,
  reviewItemStatusSchema,
} from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { toReviewItemDto } from '../dto.js';
import { clampLimit, parseOffset, parseOrThrow } from '../http-utils.js';

export function registerReviewItemRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/api/v1/review-items', async (request) => {
    const query = request.query as Record<string, unknown>;
    const status = reviewItemStatusSchema.safeParse(query['status']);

    const items = await container.repositories.reviewItems.list({
      status: status.success ? status.data : undefined,
      limit: clampLimit(query['limit'], 100),
      offset: parseOffset(query['offset']),
    });

    const runIds = [...new Set(items.map((item) => item.runId))];
    const runs = await Promise.all(
      runIds.map((runId) => container.repositories.runs.getById(runId)),
    );
    const slugByRun = new Map(
      runs.filter((run) => run !== null).map((run) => [run.id, run.workflowSlug]),
    );

    const [openCount] = await Promise.all([container.repositories.reviewItems.countOpen()]);

    return reviewItemListResponseSchema.parse({
      items: items.map((item) => toReviewItemDto(item, slugByRun.get(item.runId) ?? null)),
      openCount,
    });
  });

  app.post('/api/v1/review-items/:id/resolve', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(
      resolveReviewItemRequestSchema,
      request.body,
      'resolve review item request',
    );

    const item = await container.runService.resolveReviewItem(id, body);
    const run = await container.repositories.runs.getById(item.runId);
    return toReviewItemDto(item, run?.workflowSlug ?? null);
  });
}
