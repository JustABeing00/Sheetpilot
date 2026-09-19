import {
  ConflictError,
  createRunRequestSchema,
  decisionListResponseSchema,
  exportStatusResponseSchema,
  NotFoundError,
  reviewItemListResponseSchema,
  reviewStateForDecision,
  runListResponseSchema,
  runSnapshotDtoSchema,
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
  toRunSnapshotDto,
  toRunSnapshotSummaryDto,
  toRunSummaryDto,
} from '../dto.js';
import { clampLimit, parseOffset, parseOrThrow, tenantOf } from '../http-utils.js';

export async function describeRun(
  container: AppContainer,
  run: WorkflowRun,
  includeSteps: boolean,
): Promise<RunDto | RunSummaryDto> {
  const [reviewItemCount, openReviewItemCount, primaryFile, eventsFile, snapshot] =
    await Promise.all([
      container.repositories.reviewItems.countByRun(run.id),
      container.repositories.reviewItems.countOpenByRun(run.id),
      container.repositories.files.getById(run.primaryFileId),
      container.repositories.files.getById(run.eventsFileId),
      container.repositories.runSnapshots.getByRunId(run.id),
    ]);

  const description = {
    workflowName: container.registry.get(run.workflowSlug)?.name ?? run.workflowSlug,
    primaryFileName: primaryFile?.originalName ?? null,
    eventsFileName: eventsFile?.originalName ?? null,
    reviewItemCount,
    openReviewItemCount,
    snapshot: snapshot ? toRunSnapshotSummaryDto(snapshot) : null,
  };

  if (!includeSteps) {
    return toRunSummaryDto(run, description);
  }

  const steps = await container.repositories.steps.listByRun(run.id);
  return toRunDto(run, steps, description);
}

async function requireRun(
  container: AppContainer,
  runId: string,
  tenantId: string | null = null,
): Promise<WorkflowRun> {
  const run = await container.repositories.runs.getById(runId);
  if (!run || (tenantId != null && run.tenantId !== tenantId)) {
    throw new NotFoundError('Run', runId);
  }
  return run;
}

export function registerRunRoutes(app: FastifyInstance, container: AppContainer): void {
  app.post('/api/v1/runs', async (request, reply) => {
    const body = parseOrThrow(createRunRequestSchema, request.body, 'create run request');
    const header = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(header) ? header[0] : (header ?? null);

    // A client may safely retry a timed-out POST /runs with the same key: the second request returns
    // the original run instead of starting a duplicate execution.
    const tenantId = tenantOf(request);
    const { replayed, result } = await container.idempotency.run(idempotencyKey, async () => {
      let run: WorkflowRun;
      if (body.configurationId) {
        const resolved = await container.workflowConfigurationService.buildRunInput(
          body.configurationId,
          tenantId,
        );
        run = await container.runService.createRun({ ...resolved, tenantId });
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
          tenantId,
        });
      }

      return { statusCode: 202, body: await describeRun(container, run, true) };
    });

    if (replayed) {
      reply.header('idempotency-replayed', 'true');
    }
    reply.status(result.statusCode);
    return result.body;
  });

  app.get('/api/v1/runs', async (request) => {
    const query = request.query as Record<string, unknown>;
    const status = runStatusSchema.safeParse(query['status']);
    const runs = await container.repositories.runs.list({
      limit: clampLimit(query['limit'], 50),
      offset: parseOffset(query['offset']),
      status: status.success ? status.data : undefined,
      tenantId: tenantOf(request),
    });

    const items = await Promise.all(runs.map((run) => describeRun(container, run, false)));
    return runListResponseSchema.parse({ items });
  });

  app.get('/api/v1/runs/:id', async (request) => {
    const { id } = request.params as { id: string };
    const run = await requireRun(container, id, tenantOf(request));
    return describeRun(container, run, true);
  });

  app.get('/api/v1/runs/:id/snapshot', async (request) => {
    const { id } = request.params as { id: string };
    await requireRun(container, id, tenantOf(request));
    const snapshot = await container.runService.getSnapshot(id);
    if (!snapshot) {
      throw new NotFoundError('Run snapshot', id);
    }
    return runSnapshotDtoSchema.parse(toRunSnapshotDto(snapshot));
  });

  app.get('/api/v1/runs/:id/decisions', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    await requireRun(container, id, tenantOf(request));

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
    await requireRun(container, id, tenantOf(request));

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
    await requireRun(container, id, tenantOf(request));

    const artifacts = await container.repositories.artifacts.listByRun(id);
    return { items: artifacts.map(toArtifactDto) };
  });

  app.get('/api/v1/runs/:id/export', async (request) => {
    const { id } = request.params as { id: string };
    await requireRun(container, id, tenantOf(request));
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

  app.post('/api/v1/runs/:id/cancel', async (request) => {
    const { id } = request.params as { id: string };
    const run = await requireRun(container, id, tenantOf(request));
    if (run.status !== 'queued' && run.status !== 'running') {
      throw new ConflictError(`The run is already ${run.status} and cannot be cancelled.`);
    }

    await container.queue.cancel(id);
    container.runService.cancelRun(id);
    return describeRun(container, run, true);
  });

  app.delete('/api/v1/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await container.deletionService.deleteRun(id, tenantOf(request));
    reply.status(204);
    return null;
  });
}
