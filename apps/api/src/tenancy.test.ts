import { describe, expect, it } from 'vitest';
import { CapturingLogger, systemClock } from '@sheetpilot/core';
import { createInMemoryRepositories } from '@sheetpilot/db';
import { TenancyService } from './services/tenancy-service.js';

function makeService() {
  const repositories = createInMemoryRepositories();
  const service = new TenancyService({
    repositories,
    clock: systemClock,
    logger: CapturingLogger.create(),
    bootstrapTenantName: 'SheetPilot',
  });
  return { repositories, service };
}

describe('TenancyService', () => {
  it('creates a personal tenant with an owner membership on first use, then is idempotent', async () => {
    const { repositories, service } = makeService();

    const first = await service.ensurePersonalTenant('user-1', 'Ada');
    const second = await service.ensurePersonalTenant('user-1', 'Ada');

    expect(second).toBe(first);
    const tenants = await repositories.tenants.listForUser('user-1');
    expect(tenants).toHaveLength(1);
    expect(tenants[0]?.name).toBe("Ada's workspace");

    const membership = await repositories.memberships.getForUserAndTenant('user-1', first);
    expect(membership?.role).toBe('owner');
  });

  it('ensures exactly one bootstrap tenant', async () => {
    const { repositories, service } = makeService();

    const a = await service.ensureBootstrapTenant();
    const b = await service.ensureBootstrapTenant();

    expect(b.id).toBe(a.id);
    expect(await repositories.tenants.count()).toBe(1);
  });

  it('generates unique slugs for same-named tenants', async () => {
    const { service } = makeService();

    const a = await service.createTenant('Acme');
    const b = await service.createTenant('Acme');

    expect(a.slug).toBe('acme');
    expect(b.slug).toBe('acme-2');
  });

  it('rejects a user who is not a member of the tenant', async () => {
    const { service } = makeService();
    const tenant = await service.createTenant('Acme');

    await expect(service.requireMembership('outsider', tenant.id)).rejects.toThrow();
  });
});
