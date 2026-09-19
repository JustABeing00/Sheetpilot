import {
  ValidationError,
  type DatasetProfile,
  type WorkflowConfiguration,
  type WorkflowConfigurationDefinition,
} from '@sheetpilot/core';
import { ACCOUNT_FAULT_CONFIG_FIELDS } from './types.js';

const COLUMN_CONFIG_KEYS = new Set([
  'primaryAccountColumn',
  'eventsAccountColumn',
  'eventsTimestampColumn',
  'eventsDescriptionColumn',
  'outputRootCauseColumn',
  'outputFaultCategoryColumn',
  'outputRecommendedActionColumn',
  'outputPriorityColumn',
]);

/**
 * Scalar/boolean options for the workflow (everything that is not a mapped column). These are the same
 * fields the legacy new-run wizard exposed, re-surfaced through the configuration model.
 */
export const ACCOUNT_FAULT_CONFIGURATION_OPTIONS = ACCOUNT_FAULT_CONFIG_FIELDS.filter(
  (field) => !COLUMN_CONFIG_KEYS.has(field.key),
);

/**
 * Declarative mapping requirements for account fault triage. The setup UI renders these roles and column
 * pickers generically; nothing here is hardcoded in React.
 */
export const ACCOUNT_FAULT_CONFIGURATION_DEFINITION: WorkflowConfigurationDefinition = {
  datasetRoles: [
    {
      key: 'primary',
      label: 'Primary accounts file',
      description: 'One row per account. This is the file that receives the completed columns.',
      required: true,
      multiple: false,
    },
    {
      key: 'events',
      label: 'Fault / event file',
      description: 'One row per fault report. The same account can appear many times.',
      required: true,
      multiple: false,
    },
  ],
  columnRoles: [
    {
      key: 'primaryEntityKey',
      label: 'Account / entity identifier',
      description: 'Column in the primary file that uniquely identifies the account.',
      datasetRole: 'primary',
      semantic: 'identifier',
      required: true,
      multiple: false,
      configKey: 'primaryAccountColumn',
    },
    {
      key: 'primaryOutputColumns',
      label: 'Columns to keep in the result',
      description:
        'Primary-file columns carried into the generated output. Leave empty to keep every column.',
      datasetRole: 'primary',
      semantic: 'any',
      required: false,
      multiple: true,
      configKey: 'primaryOutputColumns',
    },
    {
      key: 'outputRootCauseColumn',
      label: 'Result column: root cause',
      description:
        'Primary-file column that should receive the root cause. Leave unmapped to add a new "RootCause" column.',
      datasetRole: 'primary',
      semantic: 'any',
      required: false,
      multiple: false,
      configKey: 'outputRootCauseColumn',
    },
    {
      key: 'outputFaultCategoryColumn',
      label: 'Result column: fault category',
      description:
        'Primary-file column that should receive the fault category. Leave unmapped to add a new "FaultCategory" column.',
      datasetRole: 'primary',
      semantic: 'any',
      required: false,
      multiple: false,
      configKey: 'outputFaultCategoryColumn',
    },
    {
      key: 'outputRecommendedActionColumn',
      label: 'Result column: recommended action',
      description:
        'Primary-file column that should receive the recommended action. Leave unmapped to add a new "RecommendedAction" column.',
      datasetRole: 'primary',
      semantic: 'any',
      required: false,
      multiple: false,
      configKey: 'outputRecommendedActionColumn',
    },
    {
      key: 'outputPriorityColumn',
      label: 'Result column: priority',
      description:
        'Primary-file column that should receive the priority. Leave unmapped to add a new "Priority" column.',
      datasetRole: 'primary',
      semantic: 'any',
      required: false,
      multiple: false,
      configKey: 'outputPriorityColumn',
    },
    {
      key: 'eventsEntityKey',
      label: 'Account / entity identifier',
      description: 'Column in the fault file that links each fault to an account.',
      datasetRole: 'events',
      semantic: 'identifier',
      required: true,
      multiple: false,
      configKey: 'eventsAccountColumn',
    },
    {
      key: 'eventsTimestamp',
      label: 'Fault date / timestamp',
      description: 'Column used to determine the latest fault per account.',
      datasetRole: 'events',
      semantic: 'timestamp',
      required: true,
      multiple: false,
      configKey: 'eventsTimestampColumn',
    },
    {
      key: 'eventsDescription',
      label: 'Fault description',
      description: 'Free-text description the classification rules are evaluated against.',
      datasetRole: 'events',
      semantic: 'description',
      required: true,
      multiple: false,
      configKey: 'eventsDescriptionColumn',
    },
  ],
  options: ACCOUNT_FAULT_CONFIGURATION_OPTIONS,
};

export interface ResolvedAccountFaultRunInput {
  primaryFileId: string;
  eventsFileId: string;
  config: Record<string, unknown>;
}

/**
 * Turns a saved configuration into the concrete run input the account-fault-triage workflow expects,
 * replacing the legacy string config keys with the mapped column names.
 */
export function resolveAccountFaultRunInput(input: {
  configuration: WorkflowConfiguration;
  datasets: DatasetProfile[];
}): ResolvedAccountFaultRunInput {
  const { configuration, datasets } = input;
  const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]));

  const datasetForRole = (role: string): DatasetProfile => {
    const assignment = configuration.assignments.find((entry) => entry.role === role);
    if (!assignment) {
      throw new ValidationError(`The configuration has no dataset assigned to "${role}".`);
    }
    const dataset = datasetById.get(assignment.datasetId);
    if (!dataset) {
      throw new ValidationError(`The dataset assigned to "${role}" could not be found.`);
    }
    return dataset;
  };

  const columnForRole = (role: string): string => {
    const mapping = configuration.mappings.find((entry) => entry.role === role);
    if (!mapping) {
      throw new ValidationError(`The configuration has no column mapped to "${role}".`);
    }
    return mapping.column;
  };

  const primary = datasetForRole('primary');
  const events = datasetForRole('events');
  const outputColumns = configuration.mappings
    .filter((entry) => entry.role === 'primaryOutputColumns')
    .map((entry) => entry.column);

  const config: Record<string, unknown> = {
    primaryAccountColumn: columnForRole('primaryEntityKey'),
    eventsAccountColumn: columnForRole('eventsEntityKey'),
    eventsTimestampColumn: columnForRole('eventsTimestamp'),
    eventsDescriptionColumn: columnForRole('eventsDescription'),
    primaryOutputColumns: outputColumns,
  };

  // Optional result-column mappings. Only set when the user actually mapped one, so the resolved
  // config stays compatible with the flat string/number/boolean run-config contract and defaults to
  // the canonical column names when omitted.
  const outputColumnRoles = [
    'outputRootCauseColumn',
    'outputFaultCategoryColumn',
    'outputRecommendedActionColumn',
    'outputPriorityColumn',
  ] as const;
  for (const role of outputColumnRoles) {
    const mapping = configuration.mappings.find((entry) => entry.role === role);
    if (mapping) {
      config[role] = mapping.column;
    }
  }

  for (const [key, value] of Object.entries(configuration.options)) {
    if (value !== undefined && value !== null) {
      config[key] = value;
    }
  }

  return { primaryFileId: primary.fileId, eventsFileId: events.fileId, config };
}

/**
 * Small preview of the run config the mapping resolves to, used by the validation endpoint so the setup
 * UI can show the user exactly which column names will reach the processing steps.
 */
export function previewAccountFaultRunConfig(input: {
  configuration: WorkflowConfiguration;
  datasets: DatasetProfile[];
}): Record<string, unknown> | null {
  try {
    return resolveAccountFaultRunInput(input).config;
  } catch {
    return null;
  }
}
