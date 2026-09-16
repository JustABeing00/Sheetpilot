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
import type { RunStatus, ReviewItemStatus, ReviewReason, ReviewSeverity } from '../domain/enums.js';
import type { ReviewResolutionLog } from '../domain/review.js';
import type { RunSnapshot } from '../domain/run-snapshot.js';
import type { StoredRuleSet } from '../domain/rules.js';
import type { DatasetRepository } from './datasets.js';
import type { WorkflowConfigurationRepository } from './workflow-configurations.js';

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

/**
 * Immutable per-run snapshot of the configuration and rule-set versions that were in force when the run
 * was created. Write-once: there is no update method by design.
 */
export interface RunSnapshotRepository {
  create(snapshot: RunSnapshot): Promise<RunSnapshot>;
  getByRunId(runId: RunId): Promise<RunSnapshot | null>;
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
  /** Single-status filter (run-scoped listings keep using this). */
  status?: ReviewItemStatus;
  /** Multi-status filter (e.g. every unresolved status). Takes precedence over `status`. */
  statuses?: ReviewItemStatus[];
  /** Only items whose primary reason is in this list. */
  reasons?: ReviewReason[];
  /** Only items with one of these severities. */
  severities?: ReviewSeverity[];
  /** Restrict to a single run. */
  runId?: RunId;
  limit?: number;
  offset?: number;
}

/** Bucketed counts for the review queue's filter chips, computed across the whole queue. */
export interface ReviewCounts {
  total: number;
  open: number;
  needsReview: number;
  overridden: number;
  conflicts: number;
  lowConfidence: number;
  processingErrors: number;
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
  counts(): Promise<ReviewCounts>;
}

export interface ReviewHistoryListOptions {
  limit?: number;
  offset?: number;
}

/** Append-only audit of human review decisions. */
export interface ReviewResolutionRepository {
  create(entry: ReviewResolutionLog): Promise<ReviewResolutionLog>;
  listByItem(reviewItemId: string): Promise<ReviewResolutionLog[]>;
  listByRun(runId: RunId, options?: ReviewHistoryListOptions): Promise<ReviewResolutionLog[]>;
}

export interface ArtifactRepository {
  create(artifact: Artifact): Promise<Artifact>;
  update(artifact: Artifact): Promise<Artifact>;
  getById(id: ArtifactId): Promise<Artifact | null>;
  listByRun(runId: RunId): Promise<Artifact[]>;
}

export interface RuleSetRepository {
  upsert(ruleSet: StoredRuleSet): Promise<StoredRuleSet>;
  getById(id: string): Promise<StoredRuleSet | null>;
  getActiveByWorkflowSlug(workflowSlug: string): Promise<StoredRuleSet | null>;
  listByWorkflowSlug(workflowSlug: string): Promise<StoredRuleSet[]>;
  list(): Promise<StoredRuleSet[]>;
}

export interface Repositories {
  files: FileRepository;
  datasets: DatasetRepository;
  workflowConfigurations: WorkflowConfigurationRepository;
  workflows: WorkflowRepository;
  runs: RunRepository;
  runSnapshots: RunSnapshotRepository;
  steps: StepRunRepository;
  decisions: DecisionRepository;
  reviewItems: ReviewItemRepository;
  reviewResolutions: ReviewResolutionRepository;
  artifacts: ArtifactRepository;
  ruleSets: RuleSetRepository;
}

export const stepRunIds = {
  forRun(runId: RunId, stepId: string): StepRunId {
    return `${runId}:${stepId}`;
  },
};
