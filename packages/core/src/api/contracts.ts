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
} from '../domain/enums.js';
import {
  outputValueSchema,
  workflowConfigFieldSchema,
  jsonObjectSchema,
  metricRecordSchema,
} from '../domain/entities.js';
import {
  datasetAnalysisSchema,
  datasetColumnSchema,
  datasetWarningSchema,
  sampleRowSchema,
} from '../domain/dataset.js';
import { ruleSchema } from '../domain/rules.js';

export const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO-8601 date-time string');

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  name: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  now: isoDateTimeSchema,
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const metaResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  environment: z.string(),
  repositoryDriver: z.string(),
  storageDriver: z.string(),
  aiProvider: z.string(),
  capabilities: z.object({
    aiProviderConfigured: z.boolean(),
    postgresRepository: z.boolean(),
    scheduler: z.boolean(),
  }),
});
export type MetaResponse = z.infer<typeof metaResponseSchema>;

export const stepRunDtoSchema = z.object({
  id: z.string(),
  stepId: z.string(),
  name: z.string(),
  order: z.number().int().nonnegative(),
  status: stepStatusSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  metrics: metricRecordSchema,
  error: z.string().nullable(),
});
export type StepRunDto = z.infer<typeof stepRunDtoSchema>;

export const runDtoSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowSlug: z.string(),
  workflowName: z.string(),
  workflowVersion: z.number().int().positive(),
  status: runStatusSchema,
  primaryFileId: z.string(),
  eventsFileId: z.string(),
  primaryFileName: z.string().nullable(),
  eventsFileName: z.string().nullable(),
  config: jsonObjectSchema,
  stats: metricRecordSchema,
  error: z.string().nullable(),
  reviewItemCount: z.number().int().nonnegative(),
  openReviewItemCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  steps: z.array(stepRunDtoSchema),
});
export type RunDto = z.infer<typeof runDtoSchema>;

export const runSummaryDtoSchema = runDtoSchema.omit({ steps: true, config: true });
export type RunSummaryDto = z.infer<typeof runSummaryDtoSchema>;

export const fileAssetDtoSchema = z.object({
  id: z.string(),
  kind: fileKindSchema,
  originalName: z.string(),
  format: tabularFormatSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string(),
  rowCount: z.number().int().nonnegative().nullable(),
  columnNames: z.array(z.string()),
  uploadedAt: isoDateTimeSchema,
});
export type FileAssetDto = z.infer<typeof fileAssetDtoSchema>;

export const datasetDtoSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  kind: fileKindSchema,
  originalName: z.string(),
  format: tabularFormatSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string(),
  sheetNames: z.array(z.string()),
  sheetName: z.string().nullable(),
  rowCount: z.number().int().nonnegative(),
  rowCountExact: z.boolean(),
  truncated: z.boolean(),
  scanLimit: z.number().int().positive(),
  columns: z.array(datasetColumnSchema),
  sampleRows: z.array(sampleRowSchema),
  warnings: z.array(datasetWarningSchema),
  inspectedAt: isoDateTimeSchema,
  rowPreviewUrl: z.string(),
});
export type DatasetDto = z.infer<typeof datasetDtoSchema>;

export const datasetSummaryDtoSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  kind: fileKindSchema,
  originalName: z.string(),
  format: tabularFormatSchema,
  sizeBytes: z.number().int().nonnegative(),
  sheetName: z.string().nullable(),
  rowCount: z.number().int().nonnegative(),
  rowCountExact: z.boolean(),
  truncated: z.boolean(),
  columnCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  inspectedAt: isoDateTimeSchema,
});
export type DatasetSummaryDto = z.infer<typeof datasetSummaryDtoSchema>;

export const datasetRowsResponseSchema = z.object({
  datasetId: z.string(),
  sheetName: z.string().nullable(),
  columns: z.array(z.string()),
  items: z.array(sampleRowSchema),
  total: z.number().int().nonnegative().nullable(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type DatasetRowsResponse = z.infer<typeof datasetRowsResponseSchema>;

export const datasetAnalysisResponseSchema = z.object({
  datasetId: z.string(),
  analysis: datasetAnalysisSchema,
});
export type DatasetAnalysisResponse = z.infer<typeof datasetAnalysisResponseSchema>;

export const datasetListResponseSchema = z.object({ items: z.array(datasetSummaryDtoSchema) });
export type DatasetListResponse = z.infer<typeof datasetListResponseSchema>;

export const reviewItemDtoSchema = z.object({
  id: z.string(),
  runId: z.string(),
  workflowSlug: z.string().nullable(),
  entityKey: z.string(),
  reason: reviewReasonSchema,
  severity: reviewSeveritySchema,
  status: reviewItemStatusSchema,
  title: z.string(),
  detail: z.string(),
  suggestedValues: z.record(z.string(), outputValueSchema),
  evidence: jsonObjectSchema,
  resolution: z
    .object({
      action: reviewActionSchema,
      values: z.record(z.string(), outputValueSchema),
      note: z.string(),
      resolvedBy: z.string().nullable(),
    })
    .nullable(),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
});
export type ReviewItemDto = z.infer<typeof reviewItemDtoSchema>;

export const decisionDtoSchema = z.object({
  id: z.string(),
  runId: z.string(),
  entityKey: z.string(),
  matchedRuleIds: z.array(z.string()),
  aiAssisted: z.boolean(),
  confidence: z.number().min(0).max(1),
  reviewReasons: z.array(reviewReasonSchema),
  outputValues: z.record(z.string(), outputValueSchema),
  evidence: jsonObjectSchema,
  createdAt: isoDateTimeSchema,
});
export type DecisionDto = z.infer<typeof decisionDtoSchema>;

export const artifactDtoSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: artifactKindSchema,
  format: tabularFormatSchema,
  fileName: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  downloadUrl: z.string(),
  createdAt: isoDateTimeSchema,
});
export type ArtifactDto = z.infer<typeof artifactDtoSchema>;

export const ruleDtoSchema = ruleSchema;
export type RuleDto = z.infer<typeof ruleDtoSchema>;

export const workflowSummaryDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.number().int().positive(),
  steps: z.array(z.object({ id: z.string(), name: z.string() })),
  ruleCount: z.number().int().nonnegative(),
});
export type WorkflowSummaryDto = z.infer<typeof workflowSummaryDtoSchema>;

export const workflowDetailDtoSchema = workflowSummaryDtoSchema.extend({
  configFields: z.array(workflowConfigFieldSchema),
  ruleSet: z.object({
    slug: z.string(),
    name: z.string(),
    version: z.number().int().positive(),
    rules: z.array(ruleDtoSchema),
  }),
});
export type WorkflowDetailDto = z.infer<typeof workflowDetailDtoSchema>;

export const createRunRequestSchema = z.object({
  workflowSlug: z.string().min(1),
  primaryFileId: z.string().min(1),
  eventsFileId: z.string().min(1),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const resolveReviewItemRequestSchema = z.object({
  action: reviewActionSchema,
  values: z.record(z.string(), outputValueSchema).default({}),
  note: z.string().max(2000).default(''),
});
export type ResolveReviewItemRequest = z.infer<typeof resolveReviewItemRequestSchema>;

export const runListResponseSchema = z.object({ items: z.array(runSummaryDtoSchema) });
export type RunListResponse = z.infer<typeof runListResponseSchema>;

export const fileListResponseSchema = z.object({ items: z.array(fileAssetDtoSchema) });
export type FileListResponse = z.infer<typeof fileListResponseSchema>;

export const reviewItemListResponseSchema = z.object({
  items: z.array(reviewItemDtoSchema),
  openCount: z.number().int().nonnegative(),
});
export type ReviewItemListResponse = z.infer<typeof reviewItemListResponseSchema>;

export const decisionListResponseSchema = z.object({
  items: z.array(decisionDtoSchema),
  total: z.number().int().nonnegative(),
});
export type DecisionListResponse = z.infer<typeof decisionListResponseSchema>;

export const artifactListResponseSchema = z.object({ items: z.array(artifactDtoSchema) });
export type ArtifactListResponse = z.infer<typeof artifactListResponseSchema>;

export const workflowListResponseSchema = z.object({ items: z.array(workflowSummaryDtoSchema) });
export type WorkflowListResponse = z.infer<typeof workflowListResponseSchema>;

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
