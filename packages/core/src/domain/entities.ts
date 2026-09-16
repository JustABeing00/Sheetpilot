import { z } from 'zod';
import {
  artifactKindSchema,
  fileKindSchema,
  reviewActionSchema,
  reviewItemStatusSchema,
  reviewReasonSchema,
  reviewSeveritySchema,
  runStatusSchema,
  stepStatusSchema,
  tabularFormatSchema,
} from './enums.js';
import { ruleSchema } from './rules.js';

export const workflowIdSchema = z.string().min(1);
export type WorkflowId = z.infer<typeof workflowIdSchema>;

export const fileIdSchema = z.string().min(1);
export type FileId = z.infer<typeof fileIdSchema>;

export const runIdSchema = z.string().min(1);
export type RunId = z.infer<typeof runIdSchema>;

export const stepRunIdSchema = z.string().min(1);
export type StepRunId = z.infer<typeof stepRunIdSchema>;

export const decisionIdSchema = z.string().min(1);
export type DecisionId = z.infer<typeof decisionIdSchema>;

export const reviewItemIdSchema = z.string().min(1);
export type ReviewItemId = z.infer<typeof reviewItemIdSchema>;

export const artifactIdSchema = z.string().min(1);
export type ArtifactId = z.infer<typeof artifactIdSchema>;

export const ruleSetIdSchema = z.string().min(1);
export type RuleSetId = z.infer<typeof ruleSetIdSchema>;

export const confidenceSchema = z.number().min(0).max(1);
export type Confidence = z.infer<typeof confidenceSchema>;

export const outputValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type OutputValue = z.infer<typeof outputValueSchema>;

export const jsonObjectSchema = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof jsonObjectSchema>;

export const metricRecordSchema = z.record(z.string(), z.number());
export type MetricRecord = z.infer<typeof metricRecordSchema>;

export const workflowConfigFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['text', 'column', 'number', 'boolean']),
  required: z.boolean().default(false),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).nullable().default(null),
  description: z.string().default(''),
});
export type WorkflowConfigField = z.infer<typeof workflowConfigFieldSchema>;

export const workflowSchema = z.object({
  id: workflowIdSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  version: z.number().int().positive(),
  steps: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  configFields: z.array(workflowConfigFieldSchema).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Workflow = z.infer<typeof workflowSchema>;

export const fileAssetSchema = z.object({
  id: fileIdSchema,
  kind: fileKindSchema,
  originalName: z.string().min(1),
  format: tabularFormatSchema,
  mimeType: z.string().default('application/octet-stream'),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  rowCount: z.number().int().nonnegative().nullable().default(null),
  columnNames: z.array(z.string()).default([]),
  storageKey: z.string().min(1),
  uploadedAt: z.date(),
});
export type FileAsset = z.infer<typeof fileAssetSchema>;

export const workflowRunSchema = z.object({
  id: runIdSchema,
  workflowId: workflowIdSchema,
  workflowSlug: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  status: runStatusSchema,
  primaryFileId: fileIdSchema,
  eventsFileId: fileIdSchema,
  configurationId: z.string().min(1).nullable().default(null),
  config: jsonObjectSchema.default({}),
  stats: metricRecordSchema.default({}),
  error: z.string().nullable().default(null),
  createdAt: z.date(),
  startedAt: z.date().nullable().default(null),
  finishedAt: z.date().nullable().default(null),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const stepRunSchema = z.object({
  id: stepRunIdSchema,
  runId: runIdSchema,
  stepId: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().nonnegative(),
  status: stepStatusSchema,
  startedAt: z.date().nullable().default(null),
  finishedAt: z.date().nullable().default(null),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  metrics: metricRecordSchema.default({}),
  error: z.string().nullable().default(null),
});
export type StepRun = z.infer<typeof stepRunSchema>;

export const decisionRecordSchema = z.object({
  id: decisionIdSchema,
  runId: runIdSchema,
  entityKey: z.string().min(1),
  matchedRuleIds: z.array(z.string()).default([]),
  aiAssisted: z.boolean().default(false),
  confidence: confidenceSchema,
  reviewReasons: z.array(reviewReasonSchema).default([]),
  outputValues: z.record(z.string(), outputValueSchema).default({}),
  evidence: jsonObjectSchema.default({}),
  createdAt: z.date(),
});
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

export const reviewResolutionSchema = z.object({
  action: reviewActionSchema,
  values: z.record(z.string(), outputValueSchema).default({}),
  note: z.string().default(''),
  resolvedBy: z.string().nullable().default(null),
});
export type ReviewResolution = z.infer<typeof reviewResolutionSchema>;

export const reviewItemSchema = z.object({
  id: reviewItemIdSchema,
  runId: runIdSchema,
  entityKey: z.string().min(1),
  reason: reviewReasonSchema,
  severity: reviewSeveritySchema,
  status: reviewItemStatusSchema,
  title: z.string().min(1),
  detail: z.string().default(''),
  suggestedValues: z.record(z.string(), outputValueSchema).default({}),
  evidence: jsonObjectSchema.default({}),
  resolution: reviewResolutionSchema.nullable().default(null),
  createdAt: z.date(),
  resolvedAt: z.date().nullable().default(null),
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const artifactSchema = z.object({
  id: artifactIdSchema,
  runId: runIdSchema,
  kind: artifactKindSchema,
  format: tabularFormatSchema,
  fileName: z.string().min(1),
  storageKey: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.date(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const classificationOptionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(''),
  category: z.string().nullable().default(null),
});
export type ClassificationOption = z.infer<typeof classificationOptionSchema>;

export const workflowRuntimeDefinitionSchema = z.object({
  workflow: workflowSchema,
  configFields: z.array(workflowConfigFieldSchema),
  ruleSet: z.object({
    slug: z.string(),
    workflowSlug: z.string(),
    name: z.string(),
    version: z.number().int().positive(),
    rules: z.array(ruleSchema),
  }),
});
export type WorkflowRuntimeDefinition = z.infer<typeof workflowRuntimeDefinitionSchema>;
