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
  Repositories,
  ReviewCounts,
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
  item: { runId: string; status: string; reason: string; severity: string },
  options?: ReviewListOptions,
): boolean {
  const statuses = options?.statuses ?? (options?.status ? [options.status] : undefined);
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

  const files: FileRepository = {
    create: (asset) => {
      fileStore.set(asset.id, asset);
      return Promise.resolve(asset);
    },
    getById: (id) => Promise.resolve(fileStore.get(id) ?? null),
    list: (limit) =>
      Promise.resolve(
        paginate(
          byDateDesc([...fileStore.values()], (asset) => asset.uploadedAt),
          { limit },
        ),
      ),
  };

  const datasets: DatasetRepository = {
    create: (dataset) => {
      datasetStore.set(dataset.id, dataset);
      return Promise.resolve(dataset);
    },
    getById: (id) => Promise.resolve(datasetStore.get(id) ?? null),
    list: (options?: DatasetListOptions) =>
      Promise.resolve(
        paginate(
          byDateDesc([...datasetStore.values()], (dataset) => dataset.inspectedAt),
          options,
        ),
      ),
  };

  const workflowConfigurations: WorkflowConfigurationRepository = {
    create: (configuration) => {
      configurationStore.set(configuration.id, configuration);
      return Promise.resolve(configuration);
    },
    update: (configuration) => {
      configurationStore.set(configuration.id, configuration);
      return Promise.resolve(configuration);
    },
    getById: (id) => Promise.resolve(configurationStore.get(id) ?? null),
    list: (options?: WorkflowConfigurationListOptions) => {
      const filtered = [...configurationStore.values()].filter(
        (configuration) =>
          options?.workflowSlug === undefined ||
          configuration.workflowSlug === options.workflowSlug,
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
    update: (run) => {
      runStore.set(run.id, run);
      return Promise.resolve(run);
    },
    getById: (id) => Promise.resolve(runStore.get(id) ?? null),
    list: (options?: RunListOptions) => {
      const filtered = [...runStore.values()].filter(
        (run) => options?.status === undefined || run.status === options.status,
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
    countOpen: () =>
      Promise.resolve([...reviewStore.values()].filter((item) => item.status === 'open').length),
    countByRun: (runId) =>
      Promise.resolve([...reviewStore.values()].filter((item) => item.runId === runId).length),
    countOpenByRun: (runId) =>
      Promise.resolve(
        [...reviewStore.values()].filter((item) => item.runId === runId && item.status === 'open')
          .length,
      ),
    counts: () => Promise.resolve(reviewCounts([...reviewStore.values()])),
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
  };

  const ruleSets: RuleSetRepository = {
    upsert: (ruleSet) => {
      ruleSetStore.set(ruleSet.id, ruleSet);
      return Promise.resolve(ruleSet);
    },
    getById: (id) => Promise.resolve(ruleSetStore.get(id) ?? null),
    getActiveByWorkflowSlug: (workflowSlug) =>
      Promise.resolve(
        [...ruleSetStore.values()].find(
          (ruleSet) => ruleSet.workflowSlug === workflowSlug && ruleSet.active,
        ) ?? null,
      ),
    listByWorkflowSlug: (workflowSlug) =>
      Promise.resolve(
        byDateDesc(
          [...ruleSetStore.values()].filter((ruleSet) => ruleSet.workflowSlug === workflowSlug),
          (ruleSet) => ruleSet.updatedAt,
        ),
      ),
    list: () =>
      Promise.resolve(byDateDesc([...ruleSetStore.values()], (ruleSet) => ruleSet.updatedAt)),
  };

  return {
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
