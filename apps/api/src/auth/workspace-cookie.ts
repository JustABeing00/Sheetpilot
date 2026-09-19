import type { FastifyReply, FastifyRequest } from 'fastify';

/** Remembers which workspace a signed-in user is currently working in. */
export const ACTIVE_WORKSPACE_COOKIE = 'sp_workspace';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Reads the caller's preferred workspace. The value is only a hint: it is untrusted and always
 * validated against the user's memberships before use, so it does not need to be signed.
 */
export function readActiveWorkspace(request: FastifyRequest): string | null {
  const value = request.cookies?.[ACTIVE_WORKSPACE_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function setActiveWorkspace(reply: FastifyReply, tenantId: string, secure: boolean): void {
  reply.setCookie(ACTIVE_WORKSPACE_COOKIE, tenantId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: ONE_YEAR_SECONDS,
  });
}
