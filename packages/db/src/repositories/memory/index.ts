import { NotFoundError } from '@sheetpilot/core';
import type {
  Artifact,
  ArtifactRepository,
  DatasetListOptions,
  DatasetProfile,
  DatasetRepository,
  DecisionListOptions,
  DecisionRecord,
  DecisionRepository,
  FileAsset,
  FileRepository,
  Membership,
  MembershipRepository,
  MembershipRole,
  Repositories,
  ReviewCounts,
  Tenant,
  TenantRepository,
  ReviewItem,
  ReviewItemRepository,
  ReviewListOptions,
  ReviewResolutionLog,
  ReviewResolutionRepository,
  RuleSetRepository,
  RunListOptions,
  RunRepository,
  RunSnapshot,
  RunSnapshotRepository,
  StepRun,
  StepRunRepository,
  StoredRuleSet,
  Workflow,
  WorkflowConfiguration,
  WorkflowConfigurationListOptions,
  WorkflowConfigurationRepository,
  WorkflowRepository,
  WorkflowRun,
} from '@sheetpilot/core';

function byDateDesc<T extends { id: string }>(items: T[], selectDate: (item: T) => Date): T[] {
  return [...items].sort(
    (left, right) =>
      selectDate(right).getTime() - selectDate(left).getTime() || left.id.localeCompare(right.id),
  );
}

function createdAt<T extends { id: string; createdAt: Date }>(item: T): Date {
  return item.createdAt;
}

function paginate<T>(items: T[], options?: { limit?: number; offset?: number }): T[] {
  const offset = options?.offset ?? 0;
  return options?.limit === undefined
    ? items.slice(offset)
    : items.slice(offset, offset + options.limit);
}

const CONFLICT_REASONS = new Set([
  'rule_conflict',
  'conflicting_fault_history',
  'ambiguous_latest_timestamp',
]);
const LOW_CONFIDENCE_REASONS = new Set(['low_confidence', 'ai_low_confidence']);

function matchesReviewOptions(
  item: {
    runId: string;
    status: string;
    reason: string;
    severity: string;
    tenantId: string | null;
  },
  options?: ReviewListOptions,
): boolean {
  const statuses = options?.statuses ?? (options?.status ? [options.status] : undefined);
  if (options?.tenantId != null && item.tenantId !== options.tenantId) {
    return false;
  }
  if (options?.runId !== undefined && item.runId !== options.runId) {
    return false;
  }
  if (statuses && !statuses.includes(item.status as never)) {
    return false;
  }
  if (options?.reasons && !options.reasons.includes(item.reason as never)) {
    return false;
  }
  if (options?.severities && !options.severities.includes(item.severity as never)) {
    return false;
  }
  return true;
}

function reviewCounts(items: ReviewItem[]): ReviewCounts {
  const result: ReviewCounts = {
    total: items.length,
    open: 0,
    needsReview: 0,
    overridden: 0,
    conflicts: 0,
    lowConfidence: 0,
    processingErrors: 0,
  };
  for (const item of items) {
    if (item.status === 'open') {
      result.open += 1;
    }
    if (item.status === 'open' && item.reason !== 'ai_failed') {
      result.needsReview += 1;
    }
    if (item.status === 'resolved_overridden') {
      result.overridden += 1;
    }
    if (CONFLICT_REASONS.has(item.reason)) {
      result.conflicts += 1;
    }
    if (LOW_CONFIDENCE_REASONS.has(item.reason)) {
      result.lowConfidence += 1;
    }
    if (item.reason === 'ai_failed') {
      result.processingErrors += 1;
    }
  }
  return result;
}

export function createInMemoryRepositories(): Repositories {
  const fileStore = new Map<string, FileAsset>();
  const datasetStore = new Map<string, DatasetProfile>();
  const configurationStore = new Map<string, WorkflowConfiguration>();
  const workflowStore = new Map<string, Workflow>();
  const runStore = new Map<string, WorkflowRun>();
  const runSnapshotStore = new Map<string, RunSnapshot>();
  const stepStore = new Map<string, StepRun[]>();
  const decisionStore = new Map<string, DecisionRecord[]>();
  const reviewStore = new Map<string, ReviewItem>();
  const resolutionStore = new Map<string, ReviewResolutionLog>();
  const artifactStore = new Map<string, Artifact>();
  const ruleSetStore = new Map<string, StoredRuleSet>();
  const tenantStore = new Map<string, Tenant>();
  const membershipStore = new Map<string, Membership>();

  const tenants: TenantRepository = {
    create: (tenant) => {
      tenantStore.set(tenant.id, tenant);
      return Promise.resolve(tenant);
    },
    update: (tenant) => {
      tenantStore.set(tenant.id, tenant);
      return Promise.resolve(tenant);
    },
    getById: (id) => Promise.resolve(tenantStore.get(id) ?? null),
    getBySlug: (slug) =>
      Promise.resolve([...tenantStore.values()].find((tenant) => tenant.slug === slug) ?? null),
    listForUser: (userId) => {
      const tenantIds = new Set(
        [...membershipStore.values()]
          .filter((membership) => membership.userId === userId)
          .map((membership) => membership.tenantId),
      );
      return Promise.resolve(
        byDateDesc(
          [...tenantStore.values()].filter((tenant) => tenantIds.has(tenant.id)),
          (tenant) => tenant.createdAt,
        ),
      );
    },
    count: () => Promise.resolve(tenantStore.size),
  };

  const memberships: MembershipRepository = {
    create: (membership) => {
      membershipStore.set(membership.id, membership);
      return Promise.resolve(membership);
    },
    update: (membership) => {
      membershipStore.set(membership.id, membership);
      return Promise.resolve(membership);
    },
    delete: (id) => {
      membershipStore.delete(id);
      return Promise.resolve();
    },
    getForUserAndTenant: (userId, tenantId) =>
      Promise.resolve(
        [...membershipStore.values()].find(
          (membership) => membership.userId === userId && membership.tenantId === tenantId,
        ) ?? null,
      ),
    listForUser: (userId) =>
      Promise.resolve(
        [...membershipStore.values()].filter((membership) => membership.userId === userId),
      ),
    listForTenant: (tenantId) =>
      Promise.resolve(
        [...membershipStore.values()].filter((membership) => membership.tenantId === tenantId),
      ),
    countForTenant: (tenantId) =>
      Promise.resolve(
        [...membershipStore.values()].filter((membership) => membership.tenantId === tenantId)
          .length,
      ),
    getDefaultForUser: (userId) => {
      const items = [...membershipStore.values()]
        .filter((membership) => membership.userId === userId)
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
        );
      return Promise.resolve(items[0] ?? null);
    },
    setRole: (id, role: MembershipRole, updatedAt) => {
      const existing = membershipStore.get(id);
      if (!existing) {
        return Promise.reject(new NotFoundError('Membership', id));
      }
      const next: Membership = { ...existing, role, updatedAt };
      membershipStore.set(id, next);
      return Promise.resolve(next);
    },
  };

  const files: FileRepository = {
    create: (asset) => {
      fileStore.set(asset.id, asset);
      return Promise.resolve(asset);
    },
    delete: (id) => {
      fileStore.delete(id);
      return Promise.resolve();
    },
    getById: (id) => Promise.resolve(fileStore.get(id) ?? null),
    list: (options) => {
      const filtered = [...fileStore.values()].filter(
        (asset) => options?.tenantId == null || asset.tenantId === options.tenantId,
      );
      return Promise.resolve(
        paginate(
          byDateDesc(filtered, (asset) => asset.uploadedAt),
          { limit: options?.limit },
        ),
      );
    },
  };

  const datasets: DatasetRepository = {
    create: (dataset) => {
      datasetStore.set(dataset.id, dataset);
      return Promise.resolve(dataset);
    },
    delete: (id) => {
      datasetStore.delete(id);
      return Promise.resolve();
    },
    getById: (id) => Promise.resolve(datasetStore.get(id) ?? null),
    list: (options?: DatasetListOptions) => {
      const filtered = [...datasetStore.values()].filter(
        (dataset) => options?.tenantId == null || dataset.tenantId === options.tenantId,
      );
      return Promise.resolve(
        paginate(
          byDateDesc(filtered, (dataset) => dataset.inspectedAt),
          options,
        ),
      );
    },
  };

  const workflowConfigurations: WorkflowConfigurationRepository = {
    create: (configuration) => {
      configurationStore.set(configuration.id, configuration);
      return Promise.resolve(configuration);
    },
    delete: (id) => {
      configurationStore.delete(id);
      return Promise.resolve();
    },
    update: (configuration) => {
      configurationStore.set(configuration.id, configuration);
      return Promise.resolve(configuration);
    },
    getById: (id) => Promise.resolve(configurationStore.get(id) ?? null),
    list: (options?: WorkflowConfigurationListOptions) => {
      const filtered = [...configurationStore.values()].filter(
        (configuration) =>
          (options?.workflowSlug === undefined ||
            configuration.workflowSlug === options.workflowSlug) &&
          (options?.tenantId == null || configuration.tenantId === options.tenantId),
      );
      return Promise.resolve(
        paginate(
          byDateDesc(filtered, (configuration) => configuration.updatedAt),
          options,
        ),
      );
    },
  };

  const workflows: WorkflowRepository = {
    upsert: (workflow) => {
      workflowStore.set(workflow.id, workflow);
      return Promise.resolve(workflow);
    },
    getById: (id) => Promise.resolve(workflowStore.get(id) ?? null),
    getBySlug: (slug) =>
      Promise.resolve(
        [...workflowStore.values()].find((workflow) => workflow.slug === slug) ?? null,
      ),
    list: () => Promise.resolve([...workflowStore.values()]),
  };

  const runs: RunRepository = {
    create: (run) => {
      runStore.set(run.id, run);
      return Promise.resolve(run);
    },
    delete: (id) => {
      runStore.delete(id);
      return Promise.resolve();
    },
    update: (run) => {
      runStore.set(run.id, run);
      return Promise.resolve(run);
    },
    getById: (id) => Promise.resolve(runStore.get(id) ?? null),
    list: (options?: RunListOptions) => {
      const filtered = [...runStore.values()].filter(
        (run) =>
          (options?.status === undefined || run.status === options.status) &&
          (options?.tenantId == null || run.tenantId === options.tenantId),
      );
      return Promise.resolve(paginate(byDateDesc(filtered, createdAt), options));
    },
    count: () => Promise.resolve(runStore.size),
  };

  const runSnapshots: RunSnapshotRepository = {
    create: (snapshot) => {
      runSnapshotStore.set(snapshot.runId, snapshot);
      return Promise.resolve(snapshot);
    },
    getByRunId: (runId) => Promise.resolve(runSnapshotStore.get(runId) ?? null),
    deleteByRun: (runId) => {
      runSnapshotStore.delete(runId);
      return Promise.resolve();
    },
  };

  const steps: StepRunRepository = {
    createMany: (records) => {
      for (const record of records) {
        const existing = stepStore.get(record.runId) ?? [];
        existing.push(record);
        stepStore.set(record.runId, existing);
      }
      return Promise.resolve();
    },
    update: (step) => {
      const existing = stepStore.get(step.runId) ?? [];
      const index = existing.findIndex((entry) => entry.id === step.id);
      if (index >= 0) {
        existing[index] = step;
      } else {
        existing.push(step);
      }
      stepStore.set(step.runId, existing);
      return Promise.resolve(step);
    },
    listByRun: (runId) =>
      Promise.resolve(
        [...(stepStore.get(runId) ?? [])].sort((left, right) => left.order - right.order),
      ),
    deleteByRun: (runId) => {
      stepStore.delete(runId);
      return Promise.resolve();
    },
  };

  const decisions: DecisionRepository = {
    createMany: (records) => {
      for (const record of records) {
        const existing = decisionStore.get(record.runId) ?? [];
        existing.push(record);
        decisionStore.set(record.runId, existing);
      }
      return Promise.resolve();
    },
    listByRun: (runId, options?: DecisionListOptions) =>
      Promise.resolve(paginate(decisionStore.get(runId) ?? [], options)),
    countByRun: (runId) => Promise.resolve((decisionStore.get(runId) ?? []).length),
    deleteByRun: (runId) => {
      decisionStore.delete(runId);
      return Promise.resolve();
    },
  };

  const reviewItems: ReviewItemRepository = {
    createMany: (items) => {
      for (const item of items) {
        reviewStore.set(item.id, item);
      }
      return Promise.resolve();
    },
    getById: (id) => Promise.resolve(reviewStore.get(id) ?? null),
    update: (item) => {
      reviewStore.set(item.id, item);
      return Promise.resolve(item);
    },
    listByRun: (runId, options?: ReviewListOptions) => {
      const filtered = [...reviewStore.values()].filter((item) =>
        matchesReviewOptions(item, { ...options, runId }),
      );
      return Promise.resolve(paginate(byDateDesc(filtered, createdAt), options));
    },
    list: (options?: ReviewListOptions) => {
      const filtered = [...reviewStore.values()].filter((item) =>
        matchesReviewOptions(item, options),
      );
      return Promise.resolve(paginate(byDateDesc(filtered, createdAt), options));
    },
    countOpen: (tenantId) =>
      Promise.resolve(
        [...reviewStore.values()].filter(
          (item) => item.status === 'open' && (tenantId == null || item.tenantId === tenantId),
        ).length,
      ),
    countByRun: (runId) =>
      Promise.resolve([...reviewStore.values()].filter((item) => item.runId === runId).length),
    countOpenByRun: (runId) =>
      Promise.resolve(
        [...reviewStore.values()].filter((item) => item.runId === runId && item.status === 'open')
          .length,
      ),
    counts: (tenantId) =>
      Promise.resolve(
        reviewCounts(
          [...reviewStore.values()].filter(
            (item) => tenantId == null || item.tenantId === tenantId,
          ),
        ),
      ),
    deleteByRun: (runId) => {
      for (const [id, item] of reviewStore) {
        if (item.runId === runId) {
          reviewStore.delete(id);
        }
      }
      return Promise.resolve();
    },
  };

  const reviewResolutions: ReviewResolutionRepository = {
    create: (entry) => {
      resolutionStore.set(entry.id, entry);
      return Promise.resolve(entry);
    },
    listByItem: (reviewItemId) =>
      Promise.resolve(
        byDateDesc(
          [...resolutionStore.values()].filter((entry) => entry.reviewItemId === reviewItemId),
          (entry) => entry.createdAt,
        ),
      ),
    listByRun: (runId, options) =>
      Promise.resolve(
        paginate(
          byDateDesc(
            [...resolutionStore.values()].filter((entry) => entry.runId === runId),
            (entry) => entry.createdAt,
          ),
          options,
        ),
      ),
    deleteByRun: (runId) => {
      for (const [id, entry] of resolutionStore) {
        if (entry.runId === runId) {
          resolutionStore.delete(id);
        }
      }
      return Promise.resolve();
    },
  };

  const artifacts: ArtifactRepository = {
    create: (artifact) => {
      artifactStore.set(artifact.id, artifact);
      return Promise.resolve(artifact);
    },
    update: (artifact) => {
      artifactStore.set(artifact.id, artifact);
      return Promise.resolve(artifact);
    },
    getById: (id) => Promise.resolve(artifactStore.get(id) ?? null),
    listByRun: (runId) =>
      Promise.resolve([...artifactStore.values()].filter((artifact) => artifact.runId === runId)),
    deleteByRun: (runId) => {
      for (const [id, artifact] of artifactStore) {
        if (artifact.runId === runId) {
          artifactStore.delete(id);
        }
      }
      return Promise.resolve();
    },
  };

  const ruleSets: RuleSetRepository = {
    upsert: (ruleSet) => {
      ruleSetStore.set(ruleSet.id, ruleSet);
      return Promise.resolve(ruleSet);
    },
    getById: (id) => Promise.resolve(ruleSetStore.get(id) ?? null),
    getActiveByWorkflowSlug: (workflowSlug, tenantId) =>
      Promise.resolve(
        [...ruleSetStore.values()].find(
          (ruleSet) =>
            ruleSet.workflowSlug === workflowSlug &&
            ruleSet.active &&
            (tenantId == null || ruleSet.tenantId === tenantId),
        ) ?? null,
      ),
    listByWorkflowSlug: (workflowSlug, tenantId) =>
      Promise.resolve(
        byDateDesc(
          [...ruleSetStore.values()].filter(
            (ruleSet) =>
              ruleSet.workflowSlug === workflowSlug &&
              (tenantId == null || ruleSet.tenantId === tenantId),
          ),
          (ruleSet) => ruleSet.updatedAt,
        ),
      ),
    list: (tenantId) =>
      Promise.resolve(
        byDateDesc(
          [...ruleSetStore.values()].filter(
            (ruleSet) => tenantId == null || ruleSet.tenantId === tenantId,
          ),
          (ruleSet) => ruleSet.updatedAt,
        ),
      ),
    delete: (id) => {
      ruleSetStore.delete(id);
      return Promise.resolve();
    },
  };

  return {
    tenants,
    memberships,
    files,
    datasets,
    workflowConfigurations,
    workflows,
    runs,
    runSnapshots,
    steps,
    decisions,
    reviewItems,
    reviewResolutions,
    artifacts,
    ruleSets,
  };
}
