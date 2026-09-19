import {
  planDefinition,
  QuotaExceededError,
  startOfUtcMonth,
  type Clock,
  type Logger,
  type PlanId,
  type PlanLimits,
  type Repositories,
} from '@sheetpilot/core';

/** Live usage for the plan metrics that are metered per tenant. */
export interface QuotaUsage {
  members: number;
  datasets: number;
  runsThisMonth: number;
}

export interface PlanSnapshot {
  plan: PlanId;
  planName: string;
  limits: PlanLimits;
  usage: QuotaUsage;
  /** The UTC calendar month the run usage refers to. */
  periodStart: string;
}

export interface QuotaServiceDeps {
  repositories: Repositories;
  clock: Clock;
  logger: Logger;
  /** When false (the default for local installs) every check passes and nothing is metered. */
  enforced: boolean;
}

interface MeteredMetric {
  limit: keyof PlanLimits;
  usage: keyof QuotaUsage;
  noun: string;
}

const METRICS = {
  members: { limit: 'maxMembers', usage: 'members', noun: 'members' },
  datasets: { limit: 'maxDatasets', usage: 'datasets', noun: 'datasets' },
  runs: { limit: 'maxRunsPerMonth', usage: 'runsThisMonth', noun: 'runs per month' },
} as const satisfies Record<string, MeteredMetric>;

/**
 * Resolves a tenant's plan and enforces its quotas. Quotas are checked at the moment the resource is
 * created (invite, upload, run) and reported through the usage endpoint; they are deliberately opt-in
 * (`QUOTAS_ENFORCED=true`) so self-hosted single-tenant installs have no artificial limits.
 */
export class QuotaService {
  constructor(private readonly deps: QuotaServiceDeps) {}

  get enforced(): boolean {
    return this.deps.enforced;
  }

  /** Current plan, limits and live usage. Readable even when enforcement is disabled. */
  async snapshot(tenantId: string | null): Promise<PlanSnapshot> {
    const tenant = tenantId ? await this.deps.repositories.tenants.getById(tenantId) : null;
    const plan = tenant?.plan ?? 'free';
    const definition = planDefinition(plan);
    const periodStart = startOfUtcMonth(this.deps.clock.now());
    const [members, datasets, runsThisMonth] = await Promise.all([
      tenantId ? this.deps.repositories.memberships.countForTenant(tenantId) : 0,
      this.deps.repositories.datasets.countForTenant(tenantId),
      this.deps.repositories.runs.countForTenantSince(tenantId, periodStart),
    ]);

    return {
      plan,
      planName: definition.name,
      limits: definition.limits,
      usage: { members, datasets, runsThisMonth },
      periodStart: periodStart.toISOString(),
    };
  }

  async assertCanAddMember(tenantId: string | null): Promise<void> {
    await this.assertWithin(METRICS.members, tenantId);
  }

  async assertCanUploadDataset(tenantId: string | null): Promise<void> {
    await this.assertWithin(METRICS.datasets, tenantId);
  }

  async assertCanCreateRun(tenantId: string | null): Promise<void> {
    await this.assertWithin(METRICS.runs, tenantId);
  }

  private async assertWithin(metric: MeteredMetric, tenantId: string | null): Promise<void> {
    if (!this.deps.enforced) {
      return;
    }
    const snapshot = await this.snapshot(tenantId);
    const limit = snapshot.limits[metric.limit];
    if (limit === null) {
      return;
    }
    const usage = snapshot.usage[metric.usage];
    if (usage >= limit) {
      this.deps.logger.warn(
        { tenantId, plan: snapshot.plan, metric: metric.usage, limit, usage },
        'plan quota reached',
      );
      throw new QuotaExceededError(
        `The ${snapshot.planName} plan is limited to ${limit} ${metric.noun}. Upgrade the plan to continue.`,
        { plan: snapshot.plan, metric: metric.usage, limit, usage },
      );
    }
  }
}
