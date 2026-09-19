import type { Membership, MembershipRole, Tenant } from '../domain/tenancy.js';

export interface TenantRepository {
  create(tenant: Tenant): Promise<Tenant>;
  update(tenant: Tenant): Promise<Tenant>;
  getById(id: string): Promise<Tenant | null>;
  getBySlug(slug: string): Promise<Tenant | null>;
  /** Every tenant the user belongs to, newest membership first. Powers the workspace switcher. */
  listForUser(userId: string): Promise<Tenant[]>;
  count(): Promise<number>;
}

export interface MembershipRepository {
  create(membership: Membership): Promise<Membership>;
  update(membership: Membership): Promise<Membership>;
  delete(id: string): Promise<void>;
  getForUserAndTenant(userId: string, tenantId: string): Promise<Membership | null>;
  listForUser(userId: string): Promise<Membership[]>;
  listForTenant(tenantId: string): Promise<Membership[]>;
  countForTenant(tenantId: string): Promise<number>;
  /** The user's oldest membership, used as the default active workspace on login. */
  getDefaultForUser(userId: string): Promise<Membership | null>;
  setRole(id: string, role: MembershipRole, updatedAt: Date): Promise<Membership>;
}
