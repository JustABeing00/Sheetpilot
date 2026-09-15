import type {
  Clock,
  DecisionRecord,
  Logger,
  MetricRecord,
  ReviewItem,
  StepStatus,
} from '@sheetpilot/core';

export interface StepContext {
  runId: string;
  workflowSlug: string;
  workflowVersion: number;
  logger: Logger;
  clock: Clock;
  signal: AbortSignal;
}

export interface StepExecution {
  stepId: string;
  name: string;
  order: number;
  status: StepStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  metrics: MetricRecord;
  error: string | null;
}

export interface StepOutcome<TState> {
  state?: Partial<TState>;
  metrics?: MetricRecord;
}

export interface StepDefinition<TState> {
  id: string;
  name: string;
  run(ctx: StepContext, state: TState): Promise<StepOutcome<TState>>;
}

export interface WorkflowProgram<TState> {
  slug: string;
  name: string;
  version: number;
  description: string;
  steps: ReadonlyArray<StepDefinition<TState>>;
  createState(input: unknown, ctx: StepContext): Promise<TState>;
}

export interface WorkflowExecutionError {
  stepId: string;
  message: string;
}

export interface WorkflowExecution<TState> {
  status: 'succeeded' | 'failed';
  state: TState | null;
  steps: StepExecution[];
  error: WorkflowExecutionError | null;
  startedAt: Date;
  finishedAt: Date;
}

export type NewDecisionRecord = Omit<DecisionRecord, 'id' | 'runId' | 'createdAt'>;

export type NewReviewItem = Omit<
  ReviewItem,
  'id' | 'runId' | 'createdAt' | 'resolvedAt' | 'status' | 'resolution'
>;
