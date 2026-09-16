import type {
  Artifact,
  ArtifactId,
  DecisionRecord,
  FileAsset,
  FileId,
  ReviewItem,
  ReviewItemId,
  RunId,
  StepRun,
  StepRunId,
  Workflow,
  WorkflowRun,
  WorkflowId,
} from '../domain/entities.js';
import type { RunStatus, ReviewItemStatus } from '../domain/enums.js';
import type { StoredRuleSet } from '../domain/rules.js';
import type { DatasetRepository } from './datasets.js';

export interface FileRepository {
  create(asset: FileAsset): Promise<FileAsset>;
  getById(id: FileId): Promise<FileAsset | null>;
  list(limit?: number): Promise<FileAsset[]>;
}

export interface WorkflowRepository {
  upsert(workflow: Workflow): Promise<Workflow>;
  getById(id: WorkflowId): Promise<Workflow | null>;
  getBySlug(slug: string): Promise<Workflow | null>;
  list(): Promise<Workflow[]>;
}

export interface RunListOptions {
  limit?: number;
  offset?: number;
  status?: RunStatus;
}

export interface RunRepository {
  create(run: WorkflowRun): Promise<WorkflowRun>;
  update(run: WorkflowRun): Promise<WorkflowRun>;
  getById(id: RunId): Promise<WorkflowRun | null>;
  list(options?: RunListOptions): Promise<WorkflowRun[]>;
  count(): Promise<number>;
}

export interface StepRunRepository {
  createMany(steps: StepRun[]): Promise<void>;
  update(step: StepRun): Promise<StepRun>;
  listByRun(runId: RunId): Promise<StepRun[]>;
}

export interface DecisionListOptions {
  limit?: number;
  offset?: number;
}

export interface DecisionRepository {
  createMany(records: DecisionRecord[]): Promise<void>;
  listByRun(runId: RunId, options?: DecisionListOptions): Promise<DecisionRecord[]>;
  countByRun(runId: RunId): Promise<number>;
}

export interface ReviewListOptions {
  status?: ReviewItemStatus;
  limit?: number;
  offset?: number;
}

export interface ReviewItemRepository {
  createMany(items: ReviewItem[]): Promise<void>;
  getById(id: ReviewItemId): Promise<ReviewItem | null>;
  update(item: ReviewItem): Promise<ReviewItem>;
  listByRun(runId: RunId, options?: ReviewListOptions): Promise<ReviewItem[]>;
  list(options?: ReviewListOptions): Promise<ReviewItem[]>;
  countOpen(): Promise<number>;
  countByRun(runId: RunId): Promise<number>;
  countOpenByRun(runId: RunId): Promise<number>;
}

export interface ArtifactRepository {
  create(artifact: Artifact): Promise<Artifact>;
  getById(id: ArtifactId): Promise<Artifact | null>;
  listByRun(runId: RunId): Promise<Artifact[]>;
}

export interface RuleSetRepository {
  upsert(ruleSet: StoredRuleSet): Promise<StoredRuleSet>;
  getById(id: string): Promise<StoredRuleSet | null>;
  getActiveByWorkflowSlug(workflowSlug: string): Promise<StoredRuleSet | null>;
  list(): Promise<StoredRuleSet[]>;
}

export interface Repositories {
  files: FileRepository;
  datasets: DatasetRepository;
  workflows: WorkflowRepository;
  runs: RunRepository;
  steps: StepRunRepository;
  decisions: DecisionRepository;
  reviewItems: ReviewItemRepository;
  artifacts: ArtifactRepository;
  ruleSets: RuleSetRepository;
}

export const stepRunIds = {
  forRun(runId: RunId, stepId: string): StepRunId {
    return `${runId}:${stepId}`;
  },
};
