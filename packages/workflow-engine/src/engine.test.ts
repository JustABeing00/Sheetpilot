import { describe, expect, it } from 'vitest';
import { CapturingLogger, fixedClock, ValidationError } from '@sheetpilot/core';
import { createStepContext, executeWorkflow } from './engine.js';
import type { StepContext, StepDefinition, WorkflowProgram } from './types.js';

interface TestState {
  order: string[];
  fail: boolean;
}

function createProgram(steps: Array<StepDefinition<TestState>>): WorkflowProgram<TestState> {
  return {
    slug: 'test-workflow',
    name: 'Test workflow',
    version: 1,
    description: 'Engine test workflow',
    steps,
    createState: () => Promise.resolve({ order: [], fail: false }),
  };
}

function createContext(signal?: AbortSignal): StepContext {
  return createStepContext({
    runId: 'run-test',
    workflowSlug: 'test-workflow',
    workflowVersion: 1,
    logger: CapturingLogger.create(),
    clock: fixedClock('2026-01-01T00:00:00Z'),
    signal,
  });
}

describe('executeWorkflow', () => {
  it('executes steps in order, merges state and records metrics', async () => {
    const steps: Array<StepDefinition<TestState>> = [
      {
        id: 'first',
        name: 'First step',
        run: (_ctx, state) =>
          Promise.resolve({ state: { order: [...state.order, 'first'] }, metrics: { rows: 2 } }),
      },
      {
        id: 'second',
        name: 'Second step',
        run: (_ctx, state) => Promise.resolve({ state: { order: [...state.order, 'second'] } }),
      },
    ];

    const execution = await executeWorkflow(createProgram(steps), {}, createContext());

    expect(execution.status).toBe('succeeded');
    expect(execution.error).toBeNull();
    expect(execution.state?.order).toEqual(['first', 'second']);
    expect(execution.steps.map((step) => step.status)).toEqual(['succeeded', 'succeeded']);
    expect(execution.steps[0]?.metrics).toEqual({ rows: 2 });
    expect(execution.steps[0]?.durationMs).toBe(0);
  });

  it('stops at the first failing step and keeps the trace', async () => {
    const steps: Array<StepDefinition<TestState>> = [
      { id: 'ok', name: 'OK step', run: () => Promise.resolve({ state: { order: ['ok'] } }) },
      {
        id: 'boom',
        name: 'Failing step',
        run: () => Promise.reject(new Error('step exploded')),
      },
      { id: 'never', name: 'Never runs', run: () => Promise.resolve({ state: {} }) },
    ];

    const execution = await executeWorkflow(createProgram(steps), {}, createContext());

    expect(execution.status).toBe('failed');
    expect(execution.error).toEqual({ stepId: 'boom', message: 'step exploded' });
    expect(execution.steps.map((step) => step.status)).toEqual(['succeeded', 'failed', 'pending']);
    expect(execution.steps[1]?.error).toBe('step exploded');
  });

  it('reports initialization failures without running steps', async () => {
    const program: WorkflowProgram<TestState> = {
      ...createProgram([]),
      createState: () => Promise.reject(new ValidationError('bad input')),
    };

    const execution = await executeWorkflow(program, {}, createContext());

    expect(execution.status).toBe('failed');
    expect(execution.state).toBeNull();
    expect(execution.error).toEqual({ stepId: 'create-state', message: 'bad input' });
  });

  it('skips remaining steps when the run is canceled', async () => {
    const controller = new AbortController();
    const steps: Array<StepDefinition<TestState>> = [
      {
        id: 'cancel-run',
        name: 'Cancel',
        run: () => {
          controller.abort();
          return Promise.resolve({ state: { order: ['canceled'] } });
        },
      },
      { id: 'after', name: 'After cancel', run: () => Promise.resolve({ state: {} }) },
    ];

    const execution = await executeWorkflow(
      createProgram(steps),
      {},
      createContext(controller.signal),
    );

    expect(execution.status).toBe('failed');
    expect(execution.error?.stepId).toBe('run');
    expect(execution.steps.map((step) => step.status)).toEqual(['succeeded', 'skipped']);
    expect(execution.state?.order).toEqual(['canceled']);
  });
});
