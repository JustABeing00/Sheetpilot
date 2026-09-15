import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { isAppError, toPublicErrorBody } from '@sheetpilot/core';
import type { AppContainer } from './container.js';
import { registerRoutes } from './http/routes/index.js';

export interface ServerOptions {
  startedAt: number;
  loggerInstance?: FastifyBaseLogger;
}

export function buildServer(container: AppContainer, options: ServerOptions): FastifyInstance {
  const app: FastifyInstance = options.loggerInstance
    ? Fastify({ loggerInstance: options.loggerInstance, bodyLimit: 2 * 1024 * 1024 })
    : Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  app.register(cors, { origin: container.config.corsOrigins });
  app.register(multipart, {
    limits: {
      fileSize: container.config.storage.maxUploadBytes,
      files: 1,
      fields: 10,
    },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isAppError(error)) {
      reply.status(error.statusCode).send(toPublicErrorBody(error));
      return;
    }

    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 400 && status < 500) {
      reply.status(status).send({
        error: {
          code: typeof error.code === 'string' ? error.code : 'request_error',
          message: error.message,
        },
      });
      return;
    }

    request.log.error({ err: error }, 'unhandled request error');
    reply.status(500).send({
      error: { code: 'internal_error', message: 'An unexpected internal error occurred' },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'not_found',
        message: `Route ${request.method} ${request.url} was not found`,
      },
    });
  });

  registerRoutes(app, container, { startedAt: options.startedAt });

  return app;
}
