import { z } from 'zod';
import { workflowConfigFieldSchema } from './entities.js';
import type { DatasetColumn, DatasetProfile } from './dataset.js';

export const workflowConfigurationIdSchema = z.string().min(1);
export type WorkflowConfigurationId = z.infer<typeof workflowConfigurationIdSchema>;

/**
 * Semantic category a mapped column is expected to satisfy. Used to validate that a dataset column is
 * compatible with the role it has been assigned to (identifiers must not be dates, timestamps must be
 * parseable, descriptions must be text, …).
 */
export const columnSemanticSchema = z.enum([
  'identifier',
  'timestamp',
  'description',
  'text',
  'any',
]);
export type ColumnSemantic = z.infer<typeof columnSemanticSchema>;

/**
 * A role a dataset can play inside a workflow ("primary", "events", "reference", …). Roles are data so a
 * new workflow defines its own roles instead of the platform hardcoding "File 1"/"File 2".
 */
export const datasetRoleDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(''),
  required: z.boolean().default(true),
  multiple: z.boolean().default(false),
});
export type DatasetRoleDefinition = z.infer<typeof datasetRoleDefinitionSchema>;

/**
 * A semantic column slot a workflow wants mapped to a real detected column. `datasetRole` ties the slot
 * to the dataset role it is expected to come from, `configKey` (optional) is the workflow configuration
 * field the resolved column name populates when a run is created.
 */
export const columnRoleDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(''),
  datasetRole: z.string().min(1),
  semantic: columnSemanticSchema.default('any'),
  required: z.boolean().default(true),
  multiple: z.boolean().default(false),
  configKey: z.string().min(1).nullable().default(null),
});
export type ColumnRoleDefinition = z.infer<typeof columnRoleDefinitionSchema>;

/**
 * The mapping requirements a workflow declares. Served to the UI through the workflow detail endpoint so
 * the setup wizard can render roles and column pickers without hardcoding workflow specifics in React.
 */
export const workflowConfigurationDefinitionSchema = z.object({
  datasetRoles: z.array(datasetRoleDefinitionSchema).default([]),
  columnRoles: z.array(columnRoleDefinitionSchema).default([]),
  options: z.array(workflowConfigFieldSchema).default([]),
});
export type WorkflowConfigurationDefinition = z.infer<typeof workflowConfigurationDefinitionSchema>;

/** Role → dataset assignment chosen by the user. */
export const datasetAssignmentSchema = z.object({
  role: z.string().min(1),
  datasetId: z.string().min(1),
  sheetName: z.string().nullable().default(null),
});
export type DatasetAssignment = z.infer<typeof datasetAssignmentSchema>;

/**
 * One mapped semantic column. A mapping points at the real detected column name; `confirmed` records the
 * user's explicit acknowledgement of an ambiguous or atypical mapping.
 */
export const columnMappingSchema = z.object({
  role: z.string().min(1),
  datasetId: z.string().min(1),
  sheetName: z.string().nullable().default(null),
  column: z.string().min(1),
  confirmed: z.boolean().default(false),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export const configurationOptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type ConfigurationOptionValue = z.infer<typeof configurationOptionValueSchema>;

/**
 * A persisted, serializable, versioned workflow configuration: which datasets play which roles, how
 * semantic column roles map to real columns, and the workflow's scalar options. It can be re-run against
 * future daily files by re-pointing the assignments.
 */
export const workflowConfigurationSchema = z.object({
  id: workflowConfigurationIdSchema,
  workflowSlug: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().default(''),
  version: z.number().int().positive().default(1),
  assignments: z.array(datasetAssignmentSchema).default([]),
  mappings: z.array(columnMappingSchema).default([]),
  options: z.record(z.string(), configurationOptionValueSchema).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type WorkflowConfiguration = z.infer<typeof workflowConfigurationSchema>;

export const workflowConfigurationSummarySchema = z.object({
  id: workflowConfigurationIdSchema,
  workflowSlug: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().default(''),
  version: z.number().int().positive(),
  datasetCount: z.number().int().nonnegative(),
  mappingCount: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type WorkflowConfigurationSummary = z.infer<typeof workflowConfigurationSummarySchema>;

export function toWorkflowConfigurationSummary(
  configuration: WorkflowConfiguration,
): WorkflowConfigurationSummary {
  return {
    id: configuration.id,
    workflowSlug: configuration.workflowSlug,
    workflowVersion: configuration.workflowVersion,
    name: configuration.name,
    description: configuration.description,
    version: configuration.version,
    datasetCount: configuration.assignments.length,
    mappingCount: configuration.mappings.length,
    createdAt: configuration.createdAt,
    updatedAt: configuration.updatedAt,
  };
}

export const configurationIssueSeveritySchema = z.enum(['error', 'warning']);
export type ConfigurationIssueSeverity = z.infer<typeof configurationIssueSeveritySchema>;

export const configurationIssueCodeSchema = z.enum([
  'missing_dataset_role',
  'unknown_dataset_role',
  'unknown_dataset',
  'duplicate_dataset_assignment',
  'missing_required_column',
  'unknown_column_role',
  'unknown_column',
  'incompatible_identifier',
  'unparseable_timestamp',
  'incompatible_description',
  'empty_column',
  'ambiguous_mapping',
  'missing_option',
  'invalid_option',
]);
export type ConfigurationIssueCode = z.infer<typeof configurationIssueCodeSchema>;

export const configurationIssueSchema = z.object({
  code: configurationIssueCodeSchema,
  severity: configurationIssueSeveritySchema,
  message: z.string().min(1),
  role: z.string().nullable().default(null),
  datasetId: z.string().nullable().default(null),
  column: z.string().nullable().default(null),
});
export type ConfigurationIssue = z.infer<typeof configurationIssueSchema>;

export const configurationValidationSchema = z.object({
  valid: z.boolean(),
  issues: z.array(configurationIssueSchema),
});
export type ConfigurationValidation = z.infer<typeof configurationValidationSchema>;

export interface ValidateWorkflowConfigurationInput {
  definition: WorkflowConfigurationDefinition;
  configuration: {
    assignments: DatasetAssignment[];
    mappings: ColumnMapping[];
    options: Record<string, ConfigurationOptionValue>;
  };
  datasets: DatasetProfile[];
}

function issue(
  code: ConfigurationIssueCode,
  severity: ConfigurationIssueSeverity,
  message: string,
  extra: Partial<Pick<ConfigurationIssue, 'role' | 'datasetId' | 'column'>> = {},
): ConfigurationIssue {
  return {
    code,
    severity,
    message,
    role: extra.role ?? null,
    datasetId: extra.datasetId ?? null,
    column: extra.column ?? null,
  };
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/;
const SLASH_TIMESTAMP = /^\d{1,2}\/\d{1,2}\/\d{2,4}([ T]\d{1,2}:\d{2}(:\d{2})?)?/;

/**
 * Lightweight compatibility check used to warn about timestamp columns before any rows are processed.
 * It mirrors the accepted shapes of the authoritative parser in `@sheetpilot/file-processing`
 * (ISO/`YYYY-MM-DD`, `DD/MM/YYYY` or `MM/DD/YYYY`, and Excel serial numbers) without importing it, so the
 * rule can also be reasoned about from the UI-facing core contracts.
 */
export function looksLikeTimestamp(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (ISO_TIMESTAMP.test(trimmed) || SLASH_TIMESTAMP.test(trimmed)) {
    return true;
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    return serial >= 20000 && serial <= 80000;
  }
  return !Number.isNaN(Date.parse(trimmed));
}

function columnIndex(datasets: DatasetProfile[]): Map<string, DatasetProfile> {
  return new Map(datasets.map((dataset) => [dataset.id, dataset]));
}

function findColumn(dataset: DatasetProfile, name: string): DatasetColumn | null {
  return dataset.columns.find((column) => column.name === name) ?? null;
}

function describeColumn(column: DatasetColumn): string {
  return `"${column.name}" (${column.type}${column.likelyDate ? ', date-like' : ''}${
    column.likelyIdentifier ? ', identifier-like' : ''
  })`;
}

function validateIdentifier(
  column: DatasetColumn,
  confirmed: boolean,
  context: { role: string; datasetId: string },
): ConfigurationIssue[] {
  const where = { role: context.role, datasetId: context.datasetId, column: column.name };
  if (column.type === 'empty') {
    return [
      issue(
        'empty_column',
        'error',
        `The identifier column ${describeColumn(column)} has no values. Pick a populated column.`,
        where,
      ),
    ];
  }
  if (column.type === 'date') {
    return [
      issue(
        confirmed ? 'incompatible_identifier' : 'incompatible_identifier',
        confirmed ? 'warning' : 'error',
        `The identifier column ${describeColumn(column)} looks like a date, which is unusual for an account/entity identifier.${
          confirmed ? ' You confirmed this mapping.' : ' Confirm the mapping to continue.'
        }`,
        where,
      ),
    ];
  }
  if (column.type === 'boolean' || column.type === 'mixed') {
    return [
      issue(
        'incompatible_identifier',
        confirmed ? 'warning' : 'error',
        `The identifier column ${describeColumn(column)} mixes incompatible values.${
          confirmed ? ' You confirmed this mapping.' : ' Confirm the mapping to continue.'
        }`,
        where,
      ),
    ];
  }
  return [];
}

function validateTimestamp(
  column: DatasetColumn,
  confirmed: boolean,
  context: { role: string; datasetId: string },
): ConfigurationIssue[] {
  const where = { role: context.role, datasetId: context.datasetId, column: column.name };
  if (column.type === 'empty') {
    return [
      issue(
        'empty_column',
        'error',
        `The timestamp column ${describeColumn(column)} has no values. Pick a populated column.`,
        where,
      ),
    ];
  }
  if (column.type === 'date' || column.likelyDate) {
    return [];
  }
  const samples = column.sampleValues.filter((value) => value.trim().length > 0);
  const parseable = samples.filter(looksLikeTimestamp).length;
  const sampleIsNumericSerial =
    column.type === 'number' &&
    samples.length > 0 &&
    samples.every((value) => looksLikeTimestamp(value) && /^\d+(\.\d+)?$/.test(value.trim()));

  if (sampleIsNumericSerial) {
    return [
      issue(
        'unparseable_timestamp',
        confirmed ? 'warning' : 'error',
        `The timestamp column ${describeColumn(column)} holds numbers that look like Excel dates.${
          confirmed ? ' You confirmed this mapping.' : ' Confirm the mapping to continue.'
        }`,
        where,
      ),
    ];
  }

  if (parseable === samples.length && samples.length > 0) {
    return [
      issue(
        'unparseable_timestamp',
        confirmed ? 'warning' : 'error',
        `The timestamp column ${describeColumn(column)} was not detected as a date, but its sample values parse as timestamps.${
          confirmed ? ' You confirmed this mapping.' : ' Confirm the mapping to continue.'
        }`,
        where,
      ),
    ];
  }

  return [
    issue(
      'unparseable_timestamp',
      'error',
      `The timestamp column ${describeColumn(column)} does not look like a date/time column. Sample values: ${
        samples.slice(0, 3).join(', ') || 'none'
      }.`,
      where,
    ),
  ];
}

function validateDescription(
  column: DatasetColumn,
  context: { role: string; datasetId: string },
): ConfigurationIssue[] {
  const where = { role: context.role, datasetId: context.datasetId, column: column.name };
  if (column.type === 'empty') {
    return [
      issue(
        'empty_column',
        'error',
        `The description column ${describeColumn(column)} has no values. Pick a populated column.`,
        where,
      ),
    ];
  }
  if (column.type === 'date' || column.type === 'number' || column.type === 'boolean') {
    return [
      issue(
        'incompatible_description',
        'warning',
        `The description column ${describeColumn(column)} does not look like free text; rules will still read its values as text.`,
        where,
      ),
    ];
  }
  return [];
}

/**
 * Pure structural + semantic validation of a workflow configuration against the workflow's declared
 * roles and the ingested dataset profiles. Returns errors (blocking) and warnings (advisory).
 */
export function validateWorkflowConfiguration(
  input: ValidateWorkflowConfigurationInput,
): ConfigurationValidation {
  const { definition, configuration } = input;
  const datasets = columnIndex(input.datasets);
  const issues: ConfigurationIssue[] = [];

  const datasetRoleByKey = new Map(definition.datasetRoles.map((role) => [role.key, role]));
  const columnRoleByKey = new Map(definition.columnRoles.map((role) => [role.key, role]));

  const assignmentsByRole = new Map<string, DatasetAssignment[]>();
  for (const assignment of configuration.assignments) {
    const list = assignmentsByRole.get(assignment.role) ?? [];
    list.push(assignment);
    assignmentsByRole.set(assignment.role, list);
  }

  for (const assignment of configuration.assignments) {
    const role = datasetRoleByKey.get(assignment.role);
    if (!role) {
      issues.push(
        issue(
          'unknown_dataset_role',
          'warning',
          `Dataset assignment references unknown role "${assignment.role}" and will be ignored.`,
          { role: assignment.role, datasetId: assignment.datasetId },
        ),
      );
    }
    if (!datasets.has(assignment.datasetId)) {
      issues.push(
        issue(
          'unknown_dataset',
          'error',
          `Dataset "${assignment.datasetId}" assigned to ${
            role?.label ?? assignment.role
          } could not be found.`,
          { role: assignment.role, datasetId: assignment.datasetId },
        ),
      );
    }
  }

  for (const role of definition.datasetRoles) {
    const assigned = assignmentsByRole.get(role.key) ?? [];
    if (role.required && assigned.length === 0) {
      issues.push(
        issue('missing_dataset_role', 'error', `Assign a dataset to "${role.label}".`, {
          role: role.key,
        }),
      );
    }
    if (!role.multiple && assigned.length > 1) {
      issues.push(
        issue(
          'duplicate_dataset_assignment',
          'warning',
          `Role "${role.label}" has multiple datasets assigned; only the first will be used.`,
          { role: role.key },
        ),
      );
    }
  }

  const mappingsByRole = new Map<string, ColumnMapping[]>();
  for (const mapping of configuration.mappings) {
    const list = mappingsByRole.get(mapping.role) ?? [];
    list.push(mapping);
    mappingsByRole.set(mapping.role, list);
  }

  for (const mapping of configuration.mappings) {
    const role = columnRoleByKey.get(mapping.role);
    if (!role) {
      issues.push(
        issue(
          'unknown_column_role',
          'warning',
          `Column mapping references unknown role "${mapping.role}" and will be ignored.`,
          { role: mapping.role, datasetId: mapping.datasetId, column: mapping.column },
        ),
      );
      continue;
    }

    const dataset = datasets.get(mapping.datasetId);
    if (!dataset) {
      issues.push(
        issue(
          'unknown_dataset',
          'error',
          `Mapped dataset "${mapping.datasetId}" could not be found.`,
          {
            role: mapping.role,
            datasetId: mapping.datasetId,
            column: mapping.column,
          },
        ),
      );
      continue;
    }

    const column = findColumn(dataset, mapping.column);
    if (!column) {
      issues.push(
        issue(
          'unknown_column',
          'error',
          `Column "${mapping.column}" for "${role.label}" does not exist in "${dataset.originalName}".`,
          { role: mapping.role, datasetId: mapping.datasetId, column: mapping.column },
        ),
      );
      continue;
    }

    const context = { role: mapping.role, datasetId: mapping.datasetId };
    if (role.semantic === 'identifier') {
      issues.push(...validateIdentifier(column, mapping.confirmed, context));
    } else if (role.semantic === 'timestamp') {
      issues.push(...validateTimestamp(column, mapping.confirmed, context));
    } else if (role.semantic === 'description') {
      issues.push(...validateDescription(column, context));
    }
  }

  for (const role of definition.columnRoles) {
    const mapped = mappingsByRole.get(role.key) ?? [];
    if (role.required && mapped.length === 0) {
      issues.push(
        issue('missing_required_column', 'error', `Map a column to "${role.label}".`, {
          role: role.key,
        }),
      );
    }
    if (!role.multiple && mapped.length > 1) {
      issues.push(
        issue(
          'ambiguous_mapping',
          'warning',
          `Column role "${role.label}" has multiple columns mapped; only the first will be used.`,
          { role: role.key },
        ),
      );
    }
  }

  for (const option of definition.options) {
    const value = configuration.options[option.key];
    if (value === undefined || value === null) {
      if (option.required) {
        issues.push(
          issue('missing_option', 'error', `Provide a value for "${option.label}".`, {
            role: option.key,
          }),
        );
      }
      continue;
    }
    const expected: Record<string, string> = {
      text: 'string',
      column: 'string',
      number: 'number',
      boolean: 'boolean',
    };
    if (typeof value !== expected[option.kind]) {
      issues.push(
        issue(
          'invalid_option',
          'error',
          `Option "${option.label}" must be a ${option.kind} value.`,
          { role: option.key },
        ),
      );
    }
  }

  return {
    valid: !issues.some((entry) => entry.severity === 'error'),
    issues,
  };
}

export const configurationIssueLabel: Record<ConfigurationIssueCode, string> = {
  missing_dataset_role: 'Missing dataset',
  unknown_dataset_role: 'Unknown dataset role',
  unknown_dataset: 'Dataset not found',
  duplicate_dataset_assignment: 'Duplicate dataset',
  missing_required_column: 'Missing column',
  unknown_column_role: 'Unknown column role',
  unknown_column: 'Column not found',
  incompatible_identifier: 'Unexpected identifier data',
  unparseable_timestamp: 'Unparseable timestamp',
  incompatible_description: 'Unexpected description data',
  empty_column: 'Empty column',
  ambiguous_mapping: 'Ambiguous mapping',
  missing_option: 'Missing option',
  invalid_option: 'Invalid option',
};
