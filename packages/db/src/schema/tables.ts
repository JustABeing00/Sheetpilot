import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  ColumnMapping,
  ConfigurationOptionValue,
  DatasetAssignment,
  DatasetColumn,
  DatasetWarning,
  OutputValue,
  ReviewAutomation,
  SampleRow,
  WorkflowConfigField,
} from '@sheetpilot/core';

const timestampColumn = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull();

export const workflows = pgTable('workflows', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  version: integer('version').notNull(),
  steps: jsonb('steps').$type<Array<{ id: string; name: string }>>().notNull(),
  configFields: jsonb('config_fields').$type<WorkflowConfigField[]>().notNull(),
  createdAt: timestampColumn('created_at'),
  updatedAt: timestampColumn('updated_at'),
});

export const ruleSets = pgTable(
  'rule_sets',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    workflowSlug: text('workflow_slug').notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    active: boolean('active').notNull(),
    rules: jsonb('rules').$type<unknown[]>().notNull(),
    createdAt: timestampColumn('created_at'),
    updatedAt: timestampColumn('updated_at'),
  },
  (table) => [index('rule_sets_workflow_slug_idx').on(table.workflowSlug, table.active)],
);

export const files = pgTable(
  'files',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    originalName: text('original_name').notNull(),
    format: text('format').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum').notNull(),
    rowCount: integer('row_count'),
    columnNames: jsonb('column_names').$type<string[]>().notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedAt: timestampColumn('uploaded_at'),
  },
  (table) => [index('files_checksum_idx').on(table.checksum)],
);

export const datasets = pgTable(
  'datasets',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id').notNull(),
    kind: text('kind').notNull(),
    originalName: text('original_name').notNull(),
    format: text('format').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum').notNull(),
    sheetNames: jsonb('sheet_names').$type<string[]>().notNull(),
    sheetName: text('sheet_name'),
    rowCount: integer('row_count').notNull(),
    rowCountExact: boolean('row_count_exact').notNull(),
    truncated: boolean('truncated').notNull(),
    scanLimit: integer('scan_limit').notNull(),
    columns: jsonb('columns').$type<DatasetColumn[]>().notNull(),
    sampleRows: jsonb('sample_rows').$type<SampleRow[]>().notNull(),
    warnings: jsonb('warnings').$type<DatasetWarning[]>().notNull(),
    inspectedAt: timestampColumn('inspected_at'),
  },
  (table) => [index('datasets_file_idx').on(table.fileId)],
);

export const workflowConfigurations = pgTable(
  'workflow_configurations',
  {
    id: text('id').primaryKey(),
    workflowSlug: text('workflow_slug').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    version: integer('version').notNull(),
    assignments: jsonb('assignments').$type<DatasetAssignment[]>().notNull(),
    mappings: jsonb('mappings').$type<ColumnMapping[]>().notNull(),
    options: jsonb('options').$type<Record<string, ConfigurationOptionValue>>().notNull(),
    createdAt: timestampColumn('created_at'),
    updatedAt: timestampColumn('updated_at'),
  },
  (table) => [index('workflow_configurations_slug_idx').on(table.workflowSlug)],
);

export const runs = pgTable(
  'runs',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    workflowSlug: text('workflow_slug').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    status: text('status').notNull(),
    primaryFileId: text('primary_file_id').notNull(),
    eventsFileId: text('events_file_id').notNull(),
    configurationId: text('configuration_id'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    stats: jsonb('stats').$type<Record<string, number>>().notNull(),
    error: text('error'),
    createdAt: timestampColumn('created_at'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('runs_status_created_idx').on(table.status, table.createdAt)],
);

export const runSteps = pgTable(
  'run_steps',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    stepId: text('step_id').notNull(),
    name: text('name').notNull(),
    stepOrder: integer('step_order').notNull(),
    status: text('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    durationMs: integer('duration_ms'),
    metrics: jsonb('metrics').$type<Record<string, number>>().notNull(),
    error: text('error'),
  },
  (table) => [index('run_steps_run_idx').on(table.runId)],
);

export const runDecisions = pgTable(
  'run_decisions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    entityKey: text('entity_key').notNull(),
    matchedRuleIds: jsonb('matched_rule_ids').$type<string[]>().notNull(),
    aiAssisted: boolean('ai_assisted').notNull(),
    decisionSource: text('decision_source').notNull().default('deterministic'),
    confidence: doublePrecision('confidence').notNull(),
    reviewReasons: jsonb('review_reasons').$type<string[]>().notNull(),
    outputValues: jsonb('output_values').$type<Record<string, unknown>>().notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    createdAt: timestampColumn('created_at'),
  },
  (table) => [index('run_decisions_run_idx').on(table.runId)],
);

export const reviewItems = pgTable(
  'review_items',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    entityKey: text('entity_key').notNull(),
    reason: text('reason').notNull(),
    severity: text('severity').notNull(),
    status: text('status').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    suggestedValues: jsonb('suggested_values').$type<Record<string, unknown>>().notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    resolution: jsonb('resolution').$type<Record<string, unknown> | null>(),
    createdAt: timestampColumn('created_at'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('review_items_run_status_idx').on(table.runId, table.status)],
);

export const reviewResolutions = pgTable(
  'review_resolutions',
  {
    id: text('id').primaryKey(),
    reviewItemId: text('review_item_id').notNull(),
    runId: text('run_id').notNull(),
    entityKey: text('entity_key').notNull(),
    action: text('action').notNull(),
    previousStatus: text('previous_status').notNull(),
    resultingState: text('resulting_state').notNull(),
    automation: jsonb('automation').$type<ReviewAutomation>().notNull(),
    suggestedValues: jsonb('suggested_values').$type<Record<string, OutputValue>>().notNull(),
    appliedValues: jsonb('applied_values').$type<Record<string, OutputValue>>().notNull(),
    changedFields: jsonb('changed_fields').$type<string[]>().notNull(),
    note: text('note').notNull(),
    resolvedBy: text('resolved_by'),
    createdAt: timestampColumn('created_at'),
  },
  (table) => [
    index('review_resolutions_item_idx').on(table.reviewItemId),
    index('review_resolutions_run_idx').on(table.runId),
  ],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    kind: text('kind').notNull(),
    format: text('format').notNull(),
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestampColumn('created_at'),
  },
  (table) => [index('artifacts_run_idx').on(table.runId)],
);

export const schema = {
  workflows,
  ruleSets,
  files,
  datasets,
  workflowConfigurations,
  runs,
  runSteps,
  runDecisions,
  reviewItems,
  reviewResolutions,
  artifacts,
};
