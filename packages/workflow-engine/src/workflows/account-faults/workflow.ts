import { parseOrThrow, type RuleSet } from '@sheetpilot/core';
import { executeWorkflow } from '../../engine.js';
import type { WorkflowDependencies, RegisteredWorkflow, WorkflowOutputs } from '../../registry.js';
import type { StepContext, WorkflowExecution, WorkflowProgram } from '../../types.js';
import {
  createBuildOutputStep,
  createClassifyStep,
  createGroupEventsStep,
  createLoadEventsStep,
  createLoadPrimaryStep,
} from './steps.js';
import { DEFAULT_ACCOUNT_FAULT_RULE_SET } from './rules.js';
import {
  ACCOUNT_FAULT_CONFIG_FIELDS,
  accountFaultConfigSchema,
  accountFaultInputSchema,
  type AccountFaultState,
} from './types.js';

export const ACCOUNT_FAULT_WORKFLOW_SLUG = 'account-fault-triage';

export interface AccountFaultWorkflowDeps extends WorkflowDependencies {
  rules?: RuleSet;
}

export function createAccountFaultProgram(
  deps: AccountFaultWorkflowDeps,
): WorkflowProgram<AccountFaultState> {
  const rules = deps.rules ?? DEFAULT_ACCOUNT_FAULT_RULE_SET;

  return {
    slug: ACCOUNT_FAULT_WORKFLOW_SLUG,
    name: 'Account fault triage',
    version: 1,
    description:
      'Matches fault events to accounts, selects the latest fault, classifies it with deterministic rules, generates the completed output and routes unusual cases to review.',
    steps: [
      createLoadPrimaryStep(deps),
      createLoadEventsStep(deps),
      createGroupEventsStep(),
      createClassifyStep(deps),
      createBuildOutputStep(),
    ],
    createState(input: unknown, ctx: StepContext): Promise<AccountFaultState> {
      const parsedInput = parseOrThrow(accountFaultInputSchema, input, 'workflow input');
      const config = parseOrThrow(
        accountFaultConfigSchema,
        parsedInput.config ?? {},
        'account fault triage configuration',
      );

      ctx.logger.debug({ config }, 'account fault triage workflow configured');

      return Promise.resolve({
        input: parsedInput,
        config,
        rules,
        primaries: [],
        events: [],
        groups: [],
        decisions: [],
        primaryColumns: [],
        outputColumns: [],
        outputRows: [],
        reviewItems: [],
        decisionRecords: [],
        stats: {},
        primaryRowsWithoutAccount: 0,
        eventsWithoutTimestamp: 0,
        orphanEventAccounts: 0,
      });
    },
  };
}

function toWorkflowOutputs(state: AccountFaultState): WorkflowOutputs {
  return {
    outputColumns: state.outputColumns,
    outputRows: state.outputRows,
    reviewItems: state.reviewItems,
    decisionRecords: state.decisionRecords,
    stats: state.stats,
  };
}

export function createAccountFaultWorkflow(deps: AccountFaultWorkflowDeps): RegisteredWorkflow {
  const program = createAccountFaultProgram(deps);

  return {
    slug: program.slug,
    name: program.name,
    version: program.version,
    description: program.description,
    stepSummaries: program.steps.map((step) => ({ id: step.id, name: step.name })),
    configFields: ACCOUNT_FAULT_CONFIG_FIELDS,
    ruleSet: deps.rules ?? DEFAULT_ACCOUNT_FAULT_RULE_SET,
    async execute(input: unknown, ctx: StepContext): Promise<WorkflowExecution<WorkflowOutputs>> {
      const execution = await executeWorkflow(program, input, ctx);
      return {
        ...execution,
        state: execution.state ? toWorkflowOutputs(execution.state) : null,
      };
    },
  };
}
