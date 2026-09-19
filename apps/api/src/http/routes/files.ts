import { fileKindSchema, NotFoundError, ValidationError } from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';
import { toFileAssetDto } from '../dto.js';
import { clampLimit, firstFieldValue, tenantOf } from '../http-utils.js';

export function registerFileRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/api/v1/files', async (request) => {
    const query = request.query as Record<string, unknown>;
    const files = await container.fileService.list(
      clampLimit(query['limit'], 100),
      tenantOf(request),
    );
    return { items: files.map(toFileAssetDto) };
  });

  app.get('/api/v1/files/:id', async (request) => {
    const { id } = request.params as { id: string };
    const file = await container.fileService.getById(id, tenantOf(request));
    if (!file) {
      throw new NotFoundError('File', id);
    }
    return toFileAssetDto(file);
  });

  app.post('/api/v1/files', async (request, reply) => {
    const uploaded = await request.file();
    if (!uploaded) {
      throw new ValidationError('Multipart form field "file" is required');
    }

    const kindField = firstFieldValue(uploaded.fields['kind']);
    const kindResult = fileKindSchema.safeParse(kindField ?? 'generic');

    const asset = await container.fileService.upload(
      {
        kind: kindResult.success ? kindResult.data : 'generic',
        originalName: uploaded.filename,
        mimeType: uploaded.mimetype,
        content: await uploaded.toBuffer(),
      },
      tenantOf(request),
    );

    reply.status(201);
    return toFileAssetDto(asset);
  });
}
