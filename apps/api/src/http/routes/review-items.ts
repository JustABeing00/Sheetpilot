import {
  reviewFilterDefinition,
  reviewFilterSchema,
  reviewHistoryResponseSchema,
  reviewItemStatusSchema,
  reviewQueueResponseSchema,
  reviewReasonSchema,
  reviewSeveritySchema,
  resolveReviewItemRequestSchema,
  NotFoundError,
  type ReviewListOptions,
} from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { toReviewItemDto, toReviewResolutionLogDto } from '../dto.js';
import { actorOf, clampLimit, parseOffset, parseOrThrow, tenantOf } from '../http-utils.js';

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function registerReviewItemRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/api/v1/review-items', async (request) => {
    const query = request.query as Record<string, unknown>;

    const filter = reviewFilterSchema.safeParse(query['filter']);
    const definition = filter.success ? reviewFilterDefinition(filter.data) : undefined;
    const status = reviewItemStatusSchema.safeParse(query['status']);
    const severity = reviewSeveritySchema.safeParse(query['severity']);
    const reasons = parseList(query['reason'])
      ?.map((entry) => reviewReasonSchema.safeParse(entry))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));

    const tenantId = tenantOf(request);
    const options: ReviewListOptions = {
      statuses: status.success ? [status.data] : definition?.statuses,
      reasons: reasons && reasons.length > 0 ? reasons : definition?.reasons,
      severities: severity.success ? [severity.data] : definition?.severities,
      runId: typeof query['runId'] === 'string' ? query['runId'] : undefined,
      tenantId,
      limit: clampLimit(query['limit'], 100),
      offset: parseOffset(query['offset']),
    };

    const [items, openCount, counts] = await Promise.all([
      container.repositories.reviewItems.list(options),
      container.repositories.reviewItems.countOpen(tenantId),
      container.repositories.reviewItems.counts(tenantId),
    ]);

    const runIds = [...new Set(items.map((item) => item.runId))];
    const runs = await Promise.all(
      runIds.map((runId) => container.repositories.runs.getById(runId)),
    );
    const slugByRun = new Map(
      runs.filter((run) => run !== null).map((run) => [run.id, run.workflowSlug]),
    );

    return reviewQueueResponseSchema.parse({
      items: items.map((item) => toReviewItemDto(item, slugByRun.get(item.runId) ?? null)),
      openCount,
      counts,
    });
  });

  app.get('/api/v1/review-items/:id', async (request) => {
    const { id } = request.params as { id: string };
    const item = await container.repositories.reviewItems.getById(id);
    if (!item || (tenantOf(request) != null && item.tenantId !== tenantOf(request))) {
      throw new NotFoundError('Review item', id);
    }
    const run = await container.repositories.runs.getById(item.runId);
    return toReviewItemDto(item, run?.workflowSlug ?? null);
  });

  app.get('/api/v1/review-items/:id/history', async (request) => {
    const { id } = request.params as { id: string };
    const history = await container.reviewService.history(id, tenantOf(request));
    return reviewHistoryResponseSchema.parse({
      items: history.map(toReviewResolutionLogDto),
    });
  });

  app.post('/api/v1/review-items/:id/resolve', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(
      resolveReviewItemRequestSchema,
      request.body,
      'resolve review item request',
    );

    const item = await container.reviewService.resolve(
      id,
      body,
      actorOf(request),
      tenantOf(request),
    );
    const run = await container.repositories.runs.getById(item.runId);
    return toReviewItemDto(item, run?.workflowSlug ?? null);
  });
}
