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
  ReviewItem,
  ReviewItemRepository,
  ReviewListOptions,
  RuleSetRepository,
  RunListOptions,
  RunRepository,
  StepRun,
  StepRunRepository,
  StoredRuleSet,
  Workflow,
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

export function createInMemoryRepositories(): Repositories {
  const fileStore = new Map<string, FileAsset>();
  const datasetStore = new Map<string, DatasetProfile>();
  const workflowStore = new Map<string, Workflow>();
  const runStore = new Map<string, WorkflowRun>();
  const stepStore = new Map<string, StepRun[]>();
  const decisionStore = new Map<string, DecisionRecord[]>();
  const reviewStore = new Map<string, ReviewItem>();
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
      const filtered = [...reviewStore.values()].filter(
        (item) =>
          item.runId === runId && (options?.status === undefined || item.status === options.status),
      );
      return Promise.resolve(paginate(byDateDesc(filtered, createdAt), options));
    },
    list: (options?: ReviewListOptions) => {
      const filtered = [...reviewStore.values()].filter(
        (item) => options?.status === undefined || item.status === options.status,
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
  };

  const artifacts: ArtifactRepository = {
    create: (artifact) => {
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
    list: () => Promise.resolve([...ruleSetStore.values()]),
  };

  return {
    files,
    datasets,
    workflows,
    runs,
    steps,
    decisions,
    reviewItems,
    artifacts,
    ruleSets,
  };
}
