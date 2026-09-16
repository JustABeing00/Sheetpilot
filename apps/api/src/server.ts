import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { isAppError, PayloadTooLargeError, toPublicErrorBody } from '@sheetpilot/core';
import type { AppContainer } from './container.js';
import { registerRoutes } from './http/routes/index.js';
import { registerSecurityHooks } from './http/security.js';

export interface ServerOptions {
  startedAt: number;
  loggerInstance?: FastifyBaseLogger;
}

export function buildServer(container: AppContainer, options: ServerOptions): FastifyInstance {
  const { security, storage } = container.config;
  const shared = {
    bodyLimit: security.jsonBodyLimitBytes,
    trustProxy: security.trustProxy,
    // Bound how long a slow client may take to send a request body.
    requestTimeout: 120_000,
  } as const;

  const app: FastifyInstance = options.loggerInstance
    ? Fastify({ loggerInstance: options.loggerInstance, ...shared })
    : Fastify({ logger: false, ...shared });

  registerSecurityHooks(app, {
    apiKey: security.apiKey,
    rateLimit: { max: security.rateLimitMax, windowMs: security.rateLimitWindowMs },
    isProduction: container.config.isProduction,
  });

  app.register(cors, { origin: container.config.corsOrigins, credentials: false });
  app.register(multipart, {
    limits: {
      fileSize: storage.maxUploadBytes,
      files: 1,
      fields: 10,
      fieldSize: 1024 * 1024,
      parts: 20,
    },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isAppError(error)) {
      const body = toPublicErrorBody(error);
      // 5xx details can contain internal context; log them but never send them to the client.
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code }, 'request failed');
        delete body.error.details;
      }
      reply.status(error.statusCode).send(body);
      return;
    }

    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (
      status === 413 ||
      error.code === 'FST_REQ_FILE_TOO_LARGE' ||
      error.code === 'FST_FILES_LIMIT'
    ) {
      reply
        .status(413)
        .send(
          toPublicErrorBody(
            new PayloadTooLargeError('The uploaded file exceeds the configured size limit.'),
          ),
        );
      return;
    }
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
