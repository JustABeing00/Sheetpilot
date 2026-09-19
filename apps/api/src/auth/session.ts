import { decode } from '@auth/core/jwt';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '@sheetpilot/config';

export interface SessionClaims {
  userId: string;
  email: string | null;
  name: string | null;
}

/**
 * Auth.js prefixes the session cookie with `__Secure-` when the app is served over HTTPS. The API sits
 * behind the Cloudflare Worker on the public HTTPS origin, so `AUTH_URL` tells us which name to read.
 */
export function sessionCookieName(config: AppConfig): string {
  return config.auth.url?.startsWith('https://') === true
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

/**
 * Reads and verifies the Auth.js JWT session cookie. Returns `null` when auth is disabled, when there
 * is no cookie, or when the token is invalid/expired. Never throws.
 */
export async function readSession(
  request: FastifyRequest,
  config: AppConfig,
): Promise<SessionClaims | null> {
  if (!config.auth.enabled || !config.auth.secret) {
    return null;
  }

  const name = sessionCookieName(config);
  const token = request.cookies?.[name];
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  try {
    const payload = await decode({ token, secret: config.auth.secret, salt: name });
    if (!payload) {
      return null;
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) {
      return null;
    }
    return {
      userId,
      email: typeof payload.email === 'string' ? payload.email : null,
      name: typeof payload.name === 'string' ? payload.name : null,
    };
  } catch {
    return null;
  }
}
