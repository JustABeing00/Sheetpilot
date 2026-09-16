import {
  createRunRequestSchema,
  decisionListResponseSchema,
  exportStatusResponseSchema,
  NotFoundError,
  reviewItemListResponseSchema,
  reviewStateForDecision,
  runListResponseSchema,
  runStatusSchema,
  ValidationError,
  type RunDto,
  type RunSummaryDto,
  type WorkflowRun,
} from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import {
  toArtifactDto,
  toDecisionDto,
  toReviewItemDto,
  toRunDto,
  toRunSummaryDto,
} from '../dto.js';
import { clampLimit, parseOffset, parseOrThrow } from '../http-utils.js';

async function describeRun(
  container: AppContainer,
  run: WorkflowRun,
  includeSteps: boolean,
): Promise<RunDto | RunSummaryDto> {
  const [reviewItemCount, openReviewItemCount, primaryFile, eventsFile] = await Promise.all([
    container.repositories.reviewItems.countByRun(run.id),
    container.repositories.reviewItems.countOpenByRun(run.id),
    container.repositories.files.getById(run.primaryFileId),
    container.repositories.files.getById(run.eventsFileId),
  ]);

  const description = {
    workflowName: container.registry.get(run.workflowSlug)?.name ?? run.workflowSlug,
    primaryFileName: primaryFile?.originalName ?? null,
    eventsFileName: eventsFile?.originalName ?? null,
    reviewItemCount,
    openReviewItemCount,
  };

  if (!includeSteps) {
    return toRunSummaryDto(run, description);
  }

  const steps = await container.repositories.steps.listByRun(run.id);
  return toRunDto(run, steps, description);
}

async function requireRun(container: AppContainer, runId: string): Promise<WorkflowRun> {
  const run = await container.repositories.runs.getById(runId);
  if (!run) {
    throw new NotFoundError('Run', runId);
  }
  return run;
}

export function registerRunRoutes(app: FastifyInstance, container: AppContainer): void {
  app.post('/api/v1/runs', async (request, reply) => {
    const body = parseOrThrow(createRunRequestSchema, request.body, 'create run request');

    let run: WorkflowRun;
    if (body.configurationId) {
      const resolved = await container.workflowConfigurationService.buildRunInput(
        body.configurationId,
      );
      run = await container.runService.createRun(resolved);
    } else {
      const { workflowSlug, primaryFileId, eventsFileId } = body;
      if (!workflowSlug || !primaryFileId || !eventsFileId) {
        throw new ValidationError(
          'Provide configurationId, or workflowSlug together with primaryFileId and eventsFileId',
        );
      }
      run = await container.runService.createRun({
        workflowSlug,
        primaryFileId,
        eventsFileId,
        configurationId: null,
        config: body.config,
      });
    }

    reply.status(202);
    return describeRun(container, run, true);
  });

  app.get('/api/v1/runs', async (request) => {
    const query = request.query as Record<string, unknown>;
    const status = runStatusSchema.safeParse(query['status']);
    const runs = await container.repositories.runs.list({
      limit: clampLimit(query['limit'], 50),
      offset: parseOffset(query['offset']),
      status: status.success ? status.data : undefined,
    });

    const items = await Promise.all(runs.map((run) => describeRun(container, run, false)));
    return runListResponseSchema.parse({ items });
  });

  app.get('/api/v1/runs/:id', async (request) => {
    const { id } = request.params as { id: string };
    const run = await requireRun(container, id);
    return describeRun(container, run, true);
  });

  app.get('/api/v1/runs/:id/decisions', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    await requireRun(container, id);

    const limit = clampLimit(query['limit'], 100);
    const offset = parseOffset(query['offset']);
    const [records, total, reviewItems] = await Promise.all([
      container.repositories.decisions.listByRun(id, { limit, offset }),
      container.repositories.decisions.countByRun(id),
      container.repositories.reviewItems.listByRun(id, { limit: 1000 }),
    ]);

    const itemByEntity = new Map(reviewItems.map((item) => [item.entityKey, item]));

    return decisionListResponseSchema.parse({
      items: records.map((record) =>
        toDecisionDto(record, reviewStateForDecision(itemByEntity.get(record.entityKey))),
      ),
      total,
    });
  });

  app.get('/api/v1/runs/:id/review-items', async (request) => {
    const { id } = request.params as { id: string };
    await requireRun(container, id);

    const [items, openCount] = await Promise.all([
      container.repositories.reviewItems.listByRun(id),
      container.repositories.reviewItems.countOpenByRun(id),
    ]);

    return reviewItemListResponseSchema.parse({
      items: items.map((item) => toReviewItemDto(item, null)),
      openCount,
    });
  });

  app.get('/api/v1/runs/:id/artifacts', async (request) => {
    const { id } = request.params as { id: string };
    await requireRun(container, id);

    const artifacts = await container.repositories.artifacts.listByRun(id);
    return { items: artifacts.map(toArtifactDto) };
  });

  app.get('/api/v1/runs/:id/export', async (request) => {
    const { id } = request.params as { id: string };
    const status = await container.exportService.status(id);

    return exportStatusResponseSchema.parse({
      runId: status.runId,
      status: status.status,
      ready: status.ready,
      message: status.message,
      summary: status.summary,
      artifacts: status.artifacts.map(toArtifactDto),
      validation: status.validation
        ? {
            validated: status.validation.validated,
            rowCount: status.validation.rowCount,
            columnCount: status.validation.columnCount,
            validatedAt: status.validation.validatedAt
              ? status.validation.validatedAt.toISOString()
              : null,
          }
        : null,
    });
  });
}
