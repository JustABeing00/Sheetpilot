import { z } from 'zod';
import { fileKindSchema, tabularFormatSchema } from './enums.js';

export const datasetIdSchema = z.string().min(1);
export type DatasetId = z.infer<typeof datasetIdSchema>;

/**
 * Column types produced by dataset inspection. `mixed` means the column held values that could not
 * be reconciled into a single primitive type across the scanned rows.
 */
export const datasetColumnTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'date',
  'empty',
  'mixed',
]);
export type DatasetColumnType = z.infer<typeof datasetColumnTypeSchema>;

export const datasetWarningSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type DatasetWarningSeverity = z.infer<typeof datasetWarningSeveritySchema>;

export const datasetWarningCodeSchema = z.enum([
  'duplicate_column_names',
  'empty_column',
  'mostly_empty_column',
  'mixed_types',
  'leading_zero_identifier',
  'truncated_scan',
]);
export type DatasetWarningCode = z.infer<typeof datasetWarningCodeSchema>;

export const datasetWarningSchema = z.object({
  code: datasetWarningCodeSchema,
  severity: datasetWarningSeveritySchema,
  message: z.string().min(1),
  column: z.string().nullable().default(null),
});
export type DatasetWarning = z.infer<typeof datasetWarningSchema>;

export const datasetColumnSchema = z.object({
  name: z.string(),
  index: z.number().int().nonnegative(),
  type: datasetColumnTypeSchema,
  nonEmptyCount: z.number().int().nonnegative(),
  emptyCount: z.number().int().nonnegative(),
  emptyRatio: z.number().min(0).max(1),
  uniqueCount: z.number().int().nonnegative(),
  uniqueRatio: z.number().min(0).max(1),
  sampleValues: z.array(z.string()),
  duplicateName: z.boolean().default(false),
  likelyDate: z.boolean().default(false),
  likelyIdentifier: z.boolean().default(false),
});
export type DatasetColumn = z.infer<typeof datasetColumnSchema>;

export const sampleRowSchema = z.record(z.string(), z.string());
export type SampleRow = z.infer<typeof sampleRowSchema>;

/**
 * The structural analysis of one sheet/table. This is the normalized representation that later
 * workflow stages (mapping, classification) consume; it never contains the full dataset, only a
 * bounded sample and aggregate statistics.
 */
export const datasetAnalysisSchema = z.object({
  sheetNames: z.array(z.string()).default([]),
  sheetName: z.string().nullable().default(null),
  rowCount: z.number().int().nonnegative(),
  rowCountExact: z.boolean().default(true),
  truncated: z.boolean().default(false),
  scanLimit: z.number().int().positive(),
  columns: z.array(datasetColumnSchema).default([]),
  sampleRows: z.array(sampleRowSchema).default([]),
  warnings: z.array(datasetWarningSchema).default([]),
});
export type DatasetAnalysis = z.infer<typeof datasetAnalysisSchema>;

/**
 * Persisted dataset: the file reference plus its structural analysis. Rows live in object storage and
 * are paged on demand, so a dataset profile stays small regardless of file size.
 */
export const datasetProfileSchema = datasetAnalysisSchema.extend({
  id: datasetIdSchema,
  tenantId: z.string().min(1).nullable().default(null),
  fileId: z.string().min(1),
  kind: fileKindSchema,
  originalName: z.string().min(1),
  format: tabularFormatSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  inspectedAt: z.date(),
});
export type DatasetProfile = z.infer<typeof datasetProfileSchema>;

export const datasetSummarySchema = z.object({
  id: datasetIdSchema,
  fileId: z.string().min(1),
  kind: fileKindSchema,
  originalName: z.string().min(1),
  format: tabularFormatSchema,
  sizeBytes: z.number().int().nonnegative(),
  sheetName: z.string().nullable(),
  rowCount: z.number().int().nonnegative(),
  rowCountExact: z.boolean(),
  truncated: z.boolean(),
  columnCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  inspectedAt: z.date(),
});
export type DatasetSummary = z.infer<typeof datasetSummarySchema>;

export function toDatasetSummary(profile: DatasetProfile): DatasetSummary {
  return {
    id: profile.id,
    fileId: profile.fileId,
    kind: profile.kind,
    originalName: profile.originalName,
    format: profile.format,
    sizeBytes: profile.sizeBytes,
    sheetName: profile.sheetName,
    rowCount: profile.rowCount,
    rowCountExact: profile.rowCountExact,
    truncated: profile.truncated,
    columnCount: profile.columns.length,
    warningCount: profile.warnings.length,
    inspectedAt: profile.inspectedAt,
  };
}
