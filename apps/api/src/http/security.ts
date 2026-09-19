import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthUser } from '../auth/types.js';

export interface SecurityOptions {
  /** When set, every route other than the health probe requires a matching `x-api-key` header. */
  apiKey: string | null;
  rateLimit: { max: number; windowMs: number };
  isProduction: boolean;
  /**
   * When provided (AUTH_ENABLED), every `/api/v1/*` route requires a valid session; the resolved user +
   * active tenant is attached to the request. `/api/auth/*` and the health probes are exempt.
   */
  authenticate?: (request: FastifyRequest) => Promise<AuthUser | null>;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const HEALTH_PATHS = ['/healthz', '/readyz'];
const MAX_TRACKED_CLIENTS = 10_000;

/** Constant-time comparison that never throws on length mismatch. */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) {
    // Still perform a comparison to avoid an obvious length oracle.
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function isHealthProbe(url: string): boolean {
  return HEALTH_PATHS.some((path) => url === path || url.startsWith(`${path}?`));
}

/**
 * Security hooks applied to every request:
 * - optional API-key authentication (off by default; the product is local/trusted-first),
 * - a cheap in-process fixed-window rate limit (per client IP),
 * - conservative response headers on every reply.
 *
 * These are deliberately non-fatal: with no API key configured the server behaves exactly as before,
 * so existing local workflows and tests are unaffected.
 */
export function registerSecurityHooks(app: FastifyInstance, options: SecurityOptions): void {
  const buckets = new Map<string, RateBucket>();

  app.addHook('onRequest', async (request, reply) => {
    if (isHealthProbe(request.url)) {
      return;
    }

    if (options.apiKey) {
      const header = request.headers['x-api-key'];
      const provided = Array.isArray(header) ? header[0] : header;
      if (typeof provided !== 'string' || !secretsMatch(provided, options.apiKey)) {
        reply
          .header('www-authenticate', 'ApiKey')
          .status(401)
          .send({ error: { code: 'unauthorized', message: 'A valid API key is required.' } });
        return reply;
      }
    }

    if (options.authenticate && request.url.startsWith('/api/v1/')) {
      const user = await options.authenticate(request);
      if (!user) {
        reply
          .status(401)
          .send({ error: { code: 'unauthorized', message: 'Sign in to continue.' } });
        return reply;
      }
      request.authUser = user;
    }

    const { max, windowMs } = options.rateLimit;
    if (max > 0) {
      const now = Date.now();
      if (buckets.size > MAX_TRACKED_CLIENTS) {
        for (const [key, bucket] of buckets) {
          if (bucket.resetAt <= now) {
            buckets.delete(key);
          }
        }
      }

      const key = request.ip;
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        bucket.count += 1;
        if (bucket.count > max) {
          const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
          reply
            .header('retry-after', String(retryAfter))
            .status(429)
            .send({
              error: {
                code: 'rate_limited',
                message: 'Too many requests. Retry after the indicated delay.',
              },
            });
          return reply;
        }
      }
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-dns-prefetch-control', 'off');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-site');
    if (options.isProduction) {
      reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
    }
    return payload;
  });
}
