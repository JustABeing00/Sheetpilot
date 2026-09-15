import {
  NotFoundError,
  type ClassificationProvider,
  type FileRepository,
  type FileStorage,
  type MetricRecord,
  type RuleSet,
  type WorkflowConfigField,
} from '@sheetpilot/core';
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

export interface RegisteredWorkflow {
  slug: string;
  name: string;
  version: number;
  description: string;
  stepSummaries: ReadonlyArray<{ id: string; name: string }>;
  configFields: ReadonlyArray<WorkflowConfigField>;
  ruleSet: RuleSet;
  execute(input: unknown, ctx: StepContext): Promise<WorkflowExecution<WorkflowOutputs>>;
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

export interface WorkflowDependencies {
  files: FileRepository;
  storage: FileStorage;
  classifier: ClassificationProvider;
}

export function createDefaultWorkflowRegistry(deps: WorkflowDependencies): WorkflowRegistry {
  return new WorkflowRegistry([createAccountFaultWorkflow(deps)]);
}
