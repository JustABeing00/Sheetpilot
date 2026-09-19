import { Auth } from '@auth/core';
import type { AuthConfig } from '@auth/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

function toFetchHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, String(entry));
      }
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

export interface AuthPluginOptions {
  authConfig: AuthConfig;
  /** The public origin the browser sees (`AUTH_URL`), so action URLs and callbacks are correct. */
  baseUrl: string | null;
}

/**
 * Mounts the Auth.js core handler at `/api/auth/*` inside Fastify by translating between Fastify's
 * request/reply and the Web `Request`/`Response` that `@auth/core` expects. This keeps auth in the same
 * deployable as the API (no second service) and behind the same Worker proxy.
 */
export function registerAuthRoutes(app: FastifyInstance, options: AuthPluginOptions): void {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const host = request.headers.host ?? 'localhost';
    const origin = options.baseUrl ?? `${request.protocol}://${host}`;
    const url = new URL(request.url, origin);
    const method = request.method;
    const body =
      method === 'GET' || method === 'HEAD'
        ? undefined
        : typeof request.body === 'string'
          ? request.body
          : undefined;

    const webRequest = new Request(url, { method, headers: toFetchHeaders(request), body });
    const response = await Auth(webRequest, options.authConfig);

    reply.status(response.status);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        return;
      }
      reply.header(key, value);
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      reply.header('set-cookie', setCookies);
    }
    return reply.send(Buffer.from(await response.arrayBuffer()));
  };

  app.route({ method: ['GET', 'POST'], url: '/api/auth/*', handler });
}
