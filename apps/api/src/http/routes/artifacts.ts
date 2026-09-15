import { NotFoundError } from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';

const MIME_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function registerArtifactRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/api/v1/artifacts/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const artifact = await container.repositories.artifacts.getById(id);
    if (!artifact) {
      throw new NotFoundError('Artifact', id);
    }

    const stream = await container.storage.getStream(artifact.storageKey);

    return reply
      .header('content-type', MIME_TYPES[artifact.format] ?? 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${artifact.fileName}"`)
      .header('content-length', String(artifact.sizeBytes))
      .send(stream);
  });
}
