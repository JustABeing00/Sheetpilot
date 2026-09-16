import {
  datasetAnalysisResponseSchema,
  datasetListResponseSchema,
  datasetRowsResponseSchema,
  fileKindSchema,
  ValidationError,
} from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { toDatasetDto, toDatasetSummaryDto } from '../dto.js';
import { clampLimit, firstFieldValue, parseOffset } from '../http-utils.js';

export function registerDatasetRoutes(app: FastifyInstance, container: AppContainer): void {
  app.post('/api/v1/datasets', async (request, reply) => {
    const uploaded = await request.file();
    if (!uploaded) {
      throw new ValidationError('Multipart form field "file" is required');
    }

    const kindResult = fileKindSchema.safeParse(
      firstFieldValue(uploaded.fields['kind']) ?? 'generic',
    );
    const sheet = firstFieldValue(uploaded.fields['sheet']);

    const { dataset } = await container.datasetService.ingest({
      kind: kindResult.success ? kindResult.data : 'generic',
      originalName: uploaded.filename,
      mimeType: uploaded.mimetype,
      content: await uploaded.toBuffer(),
      sheetName: sheet ?? undefined,
    });

    reply.status(201);
    return toDatasetDto(dataset);
  });

  app.get('/api/v1/datasets', async (request) => {
    const query = request.query as Record<string, unknown>;
    const datasets = await container.datasetService.list(
      clampLimit(query['limit'], 100),
      parseOffset(query['offset']),
    );
    return datasetListResponseSchema.parse({ items: datasets.map(toDatasetSummaryDto) });
  });

  app.get('/api/v1/datasets/:id', async (request) => {
    const { id } = request.params as { id: string };
    const dataset = await container.datasetService.getById(id);
    return toDatasetDto(dataset);
  });

  app.get('/api/v1/datasets/:id/analysis', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const sheet =
      typeof query['sheet'] === 'string' && query['sheet'].length > 0 ? query['sheet'] : undefined;
    const analysis = await container.datasetService.analyze(id, sheet);
    return datasetAnalysisResponseSchema.parse({ datasetId: id, analysis });
  });

  app.get('/api/v1/datasets/:id/rows', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const sheet =
      typeof query['sheet'] === 'string' && query['sheet'].length > 0 ? query['sheet'] : undefined;

    const page = await container.datasetService.readRows({
      datasetId: id,
      sheetName: sheet,
      limit: clampLimit(query['limit'], 50, 500),
      offset: parseOffset(query['offset']),
    });

    return datasetRowsResponseSchema.parse(page);
  });
}
