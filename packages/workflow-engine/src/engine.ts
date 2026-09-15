import type { StepContext, StepExecution, WorkflowExecution, WorkflowProgram } from './types.js';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

export async function executeWorkflow<TState>(
  program: WorkflowProgram<TState>,
  input: unknown,
  ctx: StepContext,
): Promise<WorkflowExecution<TState>> {
  const startedAt = ctx.clock.now();
  const stepExecutions: StepExecution[] = program.steps.map((step, index) => ({
    stepId: step.id,
    name: step.name,
    order: index,
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    metrics: {},
    error: null,
  }));

  let state: TState;
  try {
    state = await program.createState(input, ctx);
  } catch (error) {
    const message = errorMessage(error);
    ctx.logger.error({ err: message }, 'workflow initialization failed');
    return {
      status: 'failed',
      state: null,
      steps: stepExecutions,
      error: { stepId: 'create-state', message },
      startedAt,
      finishedAt: ctx.clock.now(),
    };
  }

  for (let index = 0; index < program.steps.length; index += 1) {
    const step = program.steps[index];
    const record = stepExecutions[index];
    if (!step || !record) {
      continue;
    }

    if (ctx.signal.aborted) {
      record.status = 'skipped';
      continue;
    }

    record.status = 'running';
    record.startedAt = ctx.clock.now();
    const stepLogger = ctx.logger.child({ stepId: step.id, stepName: step.name });

    try {
      const outcome = await step.run({ ...ctx, logger: stepLogger }, state);
      if (outcome.state) {
        state = { ...state, ...outcome.state };
      }
      record.metrics = outcome.metrics ?? {};
      record.status = 'succeeded';
    } catch (error) {
      record.status = 'failed';
      record.error = errorMessage(error);
      record.finishedAt = ctx.clock.now();
      record.durationMs = record.finishedAt.getTime() - (record.startedAt?.getTime() ?? 0);
      stepLogger.error({ err: record.error }, 'workflow step failed');
      return {
        status: 'failed',
        state,
        steps: stepExecutions,
        error: { stepId: step.id, message: record.error },
        startedAt,
        finishedAt: ctx.clock.now(),
      };
    }

    record.finishedAt = ctx.clock.now();
    record.durationMs = record.finishedAt.getTime() - (record.startedAt?.getTime() ?? 0);
    stepLogger.debug({ durationMs: record.durationMs }, 'workflow step completed');
  }

  if (ctx.signal.aborted) {
    return {
      status: 'failed',
      state,
      steps: stepExecutions,
      error: { stepId: 'run', message: 'Run was canceled' },
      startedAt,
      finishedAt: ctx.clock.now(),
    };
  }

  return {
    status: 'succeeded',
    state,
    steps: stepExecutions,
    error: null,
    startedAt,
    finishedAt: ctx.clock.now(),
  };
}

export function createStepContext(options: {
  runId: string;
  workflowSlug: string;
  workflowVersion: number;
  logger: StepContext['logger'];
  clock: StepContext['clock'];
  signal?: AbortSignal;
}): StepContext {
  return {
    runId: options.runId,
    workflowSlug: options.workflowSlug,
    workflowVersion: options.workflowVersion,
    logger: options.logger,
    clock: options.clock,
    signal: options.signal ?? new AbortController().signal,
  };
}
