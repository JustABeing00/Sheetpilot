import type { Invitation } from '../domain/tenancy.js';

/** Read-only view of an identity user (Auth.js owns writes). */
export interface IdentityUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

export interface UserRepository {
  getById(id: string): Promise<IdentityUser | null>;
  getByEmail(email: string): Promise<IdentityUser | null>;
  listByIds(ids: string[]): Promise<IdentityUser[]>;
}

export interface InvitationRepository {
  create(invitation: Invitation): Promise<Invitation>;
  getById(id: string): Promise<Invitation | null>;
  listByTenant(tenantId: string): Promise<Invitation[]>;
  listByEmail(email: string): Promise<Invitation[]>;
  delete(id: string): Promise<void>;
}
