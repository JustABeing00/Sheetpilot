import { APP_NAME, APP_VERSION, metaResponseSchema } from '@sheetpilot/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';

export function registerMetaRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/api/v1/meta', () =>
    metaResponseSchema.parse({
      name: APP_NAME,
      version: APP_VERSION,
      environment: container.config.nodeEnv,
      repositoryDriver: container.config.repository.driver,
      storageDriver: container.storage.driver,
      aiProvider: container.classifier.id,
      capabilities: {
        aiProviderConfigured: container.config.ai.configured,
        postgresRepository: container.config.repository.driver === 'postgres',
        scheduler: false,
        authEnabled: container.auth.enabled,
        authProviders: [
          ...(container.config.auth.providers.email ? ['email'] : []),
          ...(container.config.auth.providers.google ? ['google'] : []),
          ...(container.config.auth.providers.github ? ['github'] : []),
        ],
      },
    }),
  );
}
