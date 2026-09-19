import 'fastify';

/** The authenticated caller, resolved from the Auth.js session cookie on each request. */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  /** The active tenant for this request (membership-validated). */
  tenantId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}
