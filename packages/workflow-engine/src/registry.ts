import {
  NotFoundError,
  type ClassificationProvider,
  type DatasetProfile,
  type FileRepository,
  type FileStorage,
  type Logger,
  type MetricRecord,
  type RuleSet,
  type WorkflowConfigField,
  type WorkflowConfiguration,
  type WorkflowConfigurationDefinition,
} from '@sheetpilot/core';
import type { AiRedactionPolicy } from '@sheetpilot/ai';
import type { Row } from '@sheetpilot/file-processing';
import type { NewDecisionRecord, NewReviewItem, StepContext, WorkflowExecution } from './types.js';
import { createAccountFaultWorkflow } from './workflows/account-faults/workflow.js';

export interface WorkflowOutputs {
  outputColumns: string[];
  outputRows: Row[];
  reviewItems: NewReviewItem[];
  decisionRecords: NewDecisionRecord[];
  stats: MetricRecord;
}

/** Concrete run input derived from a saved configuration. */
export interface ResolvedRunInput {
  primaryFileId: string;
  eventsFileId: string;
  config: Record<string, unknown>;
}

export interface ResolveRunInputContext {
  configuration: WorkflowConfiguration;
  datasets: DatasetProfile[];
}

export interface RegisteredWorkflow {
  slug: string;
  name: string;
  version: number;
  description: string;
  stepSummaries: ReadonlyArray<{ id: string; name: string }>;
  configFields: ReadonlyArray<WorkflowConfigField>;
  configuration: WorkflowConfigurationDefinition;
  ruleSet: RuleSet;
  execute(input: unknown, ctx: StepContext): Promise<WorkflowExecution<WorkflowOutputs>>;
  resolveRunInput?(context: ResolveRunInputContext): ResolvedRunInput;
}

export class WorkflowRegistry {
  private readonly bySlug = new Map<string, RegisteredWorkflow>();

  constructor(workflows: readonly RegisteredWorkflow[]) {
    for (const workflow of workflows) {
      this.bySlug.set(workflow.slug, workflow);
    }
  }

  list(): RegisteredWorkflow[] {
    return [...this.bySlug.values()];
  }

  get(slug: string): RegisteredWorkflow | null {
    return this.bySlug.get(slug) ?? null;
  }

  require(slug: string): RegisteredWorkflow {
    const workflow = this.get(slug);
    if (!workflow) {
      throw new NotFoundError('Workflow', slug);
    }
    return workflow;
  }
}

export interface AiWorkflowOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  redaction?: Partial<AiRedactionPolicy>;
}

export interface WorkflowDependencies {
  files: FileRepository;
  storage: FileStorage;
  classifier: ClassificationProvider;
  logger?: Logger;
  /** Orchestration options for the AI layer (timeouts, retries, redaction). */
  ai?: AiWorkflowOptions;
}

export function createDefaultWorkflowRegistry(deps: WorkflowDependencies): WorkflowRegistry {
  return new WorkflowRegistry([createAccountFaultWorkflow(deps)]);
}
