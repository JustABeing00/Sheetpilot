import {
  newId,
  NotFoundError,
  personalTenantName,
  tenantSlug,
  type Clock,
  type Logger,
  type Membership,
  type Repositories,
  type Tenant,
} from '@sheetpilot/core';

export interface TenancyServiceDeps {
  repositories: Repositories;
  clock: Clock;
  logger: Logger;
  bootstrapTenantName: string;
}

/**
 * Owns the workspace (tenant) lifecycle: creating a tenant, provisioning a personal workspace on first
 * login, ensuring the legacy/bootstrap tenant exists, and validating that a user may act in a tenant.
 */
export class TenancyService {
  constructor(private readonly deps: TenancyServiceDeps) {}

  async createTenant(name: string): Promise<Tenant> {
    const base = tenantSlug(name);
    let slug = base;
    let suffix = 1;
    while (await this.deps.repositories.tenants.getBySlug(slug)) {
      suffix += 1;
      slug = `${base}-${suffix}`;
    }
    const now = this.deps.clock.now();
    const tenant = await this.deps.repositories.tenants.create({
      id: newId(),
      name,
      slug,
      plan: 'free',
      createdAt: now,
      updatedAt: now,
    });
    this.deps.logger.info({ tenantId: tenant.id, slug }, 'tenant created');
    return tenant;
  }

  /** Returns the active tenant id, creating a personal workspace if the user has none yet. */
  async ensurePersonalTenant(userId: string, label: string | null): Promise<string> {
    const existing = await this.deps.repositories.memberships.getDefaultForUser(userId);
    if (existing) {
      return existing.tenantId;
    }
    const tenant = await this.createTenant(personalTenantName(label));
    const now = this.deps.clock.now();
    await this.deps.repositories.memberships.create({
      id: newId(),
      tenantId: tenant.id,
      userId,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    });
    return tenant.id;
  }

  /**
   * The tenant that owns data created before authentication existed (legacy rows / single-tenant use).
   * Created once, idempotently, so the backfill always has a valid target.
   */
  async ensureBootstrapTenant(): Promise<Tenant> {
    const existing = await this.deps.repositories.tenants.getBySlug(
      tenantSlug(this.deps.bootstrapTenantName),
    );
    if (existing) {
      return existing;
    }
    return this.createTenant(this.deps.bootstrapTenantName);
  }

  async requireMembership(userId: string, tenantId: string): Promise<Membership> {
    const membership = await this.deps.repositories.memberships.getForUserAndTenant(
      userId,
      tenantId,
    );
    if (!membership) {
      throw new NotFoundError('Workspace', tenantId);
    }
    return membership;
  }

  async listForUser(userId: string): Promise<Tenant[]> {
    return this.deps.repositories.tenants.listForUser(userId);
  }
}
