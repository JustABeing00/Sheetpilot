import type {
  Artifact,
  AiAssistOutcome,
  DecisionRecord,
  DatasetProfile,
  DatasetSummary,
  FileAsset,
  ReviewItem,
  ReviewResolutionLog,
  ReviewState,
  RunDto,
  RunSnapshot,
  RunSummaryDto,
  StepRun,
  StoredRuleSet,
  WorkflowConfiguration,
  WorkflowConfigurationSummary,
  WorkflowRun,
} from '@sheetpilot/core';
import {
  aiAssistOutcomeSchema,
  changedFields,
  reviewAutomationFromEvidence,
  reviewEventsFromEvidence,
  reviewStateForItem,
  toRunSnapshotSummary,
} from '@sheetpilot/core';
import type { RegisteredWorkflow } from '@sheetpilot/workflow-engine';
import type {
  ArtifactDto,
  DatasetDto,
  DatasetSummaryDto,
  DecisionDto,
  FileAssetDto,
  ReviewItemDto,
  ReviewResolutionLogDto,
  RuleSetDto,
  RunSnapshotDto,
  RunSnapshotSummaryDto,
  RuleSetSummaryDto,
  StepRunDto,
  WorkflowConfigurationDto,
  WorkflowConfigurationSummaryDto,
  WorkflowDetailDto,
  WorkflowSummaryDto,
} from '@sheetpilot/core';

export function toWorkflowConfigurationDto(
  configuration: WorkflowConfiguration,
): WorkflowConfigurationDto {
  return {
    id: configuration.id,
    workflowSlug: configuration.workflowSlug,
    workflowVersion: configuration.workflowVersion,
    name: configuration.name,
    description: configuration.description,
    version: configuration.version,
    assignments: configuration.assignments,
    mappings: configuration.mappings,
    options: configuration.options,
    createdAt: configuration.createdAt.toISOString(),
    updatedAt: configuration.updatedAt.toISOString(),
  };
}

export function toWorkflowConfigurationSummaryDto(
  configuration: WorkflowConfigurationSummary,
): WorkflowConfigurationSummaryDto {
  return {
    id: configuration.id,
    workflowSlug: configuration.workflowSlug,
    workflowVersion: configuration.workflowVersion,
    name: configuration.name,
    description: configuration.description,
    version: configuration.version,
    datasetCount: configuration.datasetCount,
    mappingCount: configuration.mappingCount,
    createdAt: configuration.createdAt.toISOString(),
    updatedAt: configuration.updatedAt.toISOString(),
  };
}

export function toDatasetDto(dataset: DatasetProfile): DatasetDto {
  return {
    id: dataset.id,
    fileId: dataset.fileId,
    kind: dataset.kind,
    originalName: dataset.originalName,
    format: dataset.format,
    mimeType: dataset.mimeType,
    sizeBytes: dataset.sizeBytes,
    checksum: dataset.checksum,
    sheetNames: dataset.sheetNames,
    sheetName: dataset.sheetName,
    rowCount: dataset.rowCount,
    rowCountExact: dataset.rowCountExact,
    truncated: dataset.truncated,
    scanLimit: dataset.scanLimit,
    columns: dataset.columns,
    sampleRows: dataset.sampleRows,
    warnings: dataset.warnings,
    inspectedAt: dataset.inspectedAt.toISOString(),
    rowPreviewUrl: `/api/v1/datasets/${dataset.id}/rows`,
  };
}

export function toDatasetSummaryDto(dataset: DatasetSummary): DatasetSummaryDto {
  return {
    id: dataset.id,
    fileId: dataset.fileId,
    kind: dataset.kind,
    originalName: dataset.originalName,
    format: dataset.format,
    sizeBytes: dataset.sizeBytes,
    sheetName: dataset.sheetName,
    rowCount: dataset.rowCount,
    rowCountExact: dataset.rowCountExact,
    truncated: dataset.truncated,
    columnCount: dataset.columnCount,
    warningCount: dataset.warningCount,
    inspectedAt: dataset.inspectedAt.toISOString(),
  };
}

export function toFileAssetDto(asset: FileAsset): FileAssetDto {
  return {
    id: asset.id,
    kind: asset.kind,
    originalName: asset.originalName,
    format: asset.format,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    checksum: asset.checksum,
    rowCount: asset.rowCount,
    columnNames: asset.columnNames,
    uploadedAt: asset.uploadedAt.toISOString(),
  };
}

export function toStepRunDto(step: StepRun): StepRunDto {
  return {
    id: step.id,
    stepId: step.stepId,
    name: step.name,
    order: step.order,
    status: step.status,
    startedAt: step.startedAt ? step.startedAt.toISOString() : null,
    finishedAt: step.finishedAt ? step.finishedAt.toISOString() : null,
    durationMs: step.durationMs,
    metrics: step.metrics,
    error: step.error,
  };
}

export interface RunDescription {
  workflowName: string;
  primaryFileName: string | null;
  eventsFileName: string | null;
  reviewItemCount: number;
  openReviewItemCount: number;
  snapshot: RunSnapshotSummaryDto | null;
}

export function toRunSnapshotSummaryDto(snapshot: RunSnapshot): RunSnapshotSummaryDto {
  return {
    ...toRunSnapshotSummary(snapshot),
    capturedAt: snapshot.capturedAt.toISOString(),
  };
}

export function toRunSnapshotDto(snapshot: RunSnapshot): RunSnapshotDto {
  return {
    runId: snapshot.runId,
    workflowSlug: snapshot.workflowSlug,
    workflowVersion: snapshot.workflowVersion,
    capturedAt: snapshot.capturedAt.toISOString(),
    configuration: snapshot.configuration
      ? toWorkflowConfigurationDto(snapshot.configuration)
      : null,
    ruleSet: snapshot.ruleSet ? toRuleSetDto(snapshot.ruleSet) : null,
  };
}

export function toRunDto(run: WorkflowRun, steps: StepRun[], description: RunDescription): RunDto {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowSlug: run.workflowSlug,
    workflowName: description.workflowName,
    workflowVersion: run.workflowVersion,
    status: run.status,
    primaryFileId: run.primaryFileId,
    eventsFileId: run.eventsFileId,
    configurationId: run.configurationId,
    primaryFileName: description.primaryFileName,
    eventsFileName: description.eventsFileName,
    config: run.config,
    stats: run.stats,
    error: run.error,
    reviewItemCount: description.reviewItemCount,
    openReviewItemCount: description.openReviewItemCount,
    snapshot: description.snapshot,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    steps: steps.map(toStepRunDto),
  };
}

export function toRunSummaryDto(run: WorkflowRun, description: RunDescription): RunSummaryDto {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowSlug: run.workflowSlug,
    workflowName: description.workflowName,
    workflowVersion: run.workflowVersion,
    status: run.status,
    primaryFileId: run.primaryFileId,
    eventsFileId: run.eventsFileId,
    configurationId: run.configurationId,
    primaryFileName: description.primaryFileName,
    eventsFileName: description.eventsFileName,
    stats: run.stats,
    error: run.error,
    reviewItemCount: description.reviewItemCount,
    openReviewItemCount: description.openReviewItemCount,
    snapshot: description.snapshot,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  };
}

export function toReviewItemDto(item: ReviewItem, workflowSlug: string | null): ReviewItemDto {
  const automation = reviewAutomationFromEvidence(item.evidence, item.suggestedValues);
  const { latestEvent, history } = reviewEventsFromEvidence(item.evidence);

  return {
    id: item.id,
    runId: item.runId,
    workflowSlug,
    entityKey: item.entityKey,
    reason: item.reason,
    severity: item.severity,
    status: item.status,
    state: reviewStateForItem(item),
    title: item.title,
    detail: item.detail,
    suggestedValues: item.suggestedValues,
    automation,
    latestEvent,
    eventHistory: history,
    evidence: item.evidence,
    ai: toAiOutcome(item.evidence),
    resolution: item.resolution
      ? {
          action: item.resolution.action,
          values: item.resolution.values,
          note: item.resolution.note,
          resolvedBy: item.resolution.resolvedBy,
          changedFields: changedFields(automation.values, item.resolution.values),
        }
      : null,
    createdAt: item.createdAt.toISOString(),
    resolvedAt: item.resolvedAt ? item.resolvedAt.toISOString() : null,
  };
}

export function toReviewResolutionLogDto(entry: ReviewResolutionLog): ReviewResolutionLogDto {
  return {
    id: entry.id,
    reviewItemId: entry.reviewItemId,
    runId: entry.runId,
    entityKey: entry.entityKey,
    action: entry.action,
    previousStatus: entry.previousStatus,
    resultingState: entry.resultingState,
    automation: entry.automation,
    suggestedValues: entry.suggestedValues,
    appliedValues: entry.appliedValues,
    changedFields: entry.changedFields,
    note: entry.note,
    resolvedBy: entry.resolvedBy,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function toDecisionDto(record: DecisionRecord, reviewState: ReviewState): DecisionDto {
  return {
    id: record.id,
    runId: record.runId,
    entityKey: record.entityKey,
    matchedRuleIds: record.matchedRuleIds,
    aiAssisted: record.aiAssisted,
    decisionSource: record.decisionSource,
    confidence: record.confidence,
    reviewReasons: record.reviewReasons,
    outputValues: record.outputValues,
    evidence: record.evidence,
    ai: toAiOutcome(record.evidence),
    reviewState,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Decision evidence stores the full AI provenance block (`{ outcome, providerId, ... }`); the DTO
 * exposes just the validated outcome so clients can render it without trusting arbitrary JSON.
 */
function toAiOutcome(evidence: Record<string, unknown>): AiAssistOutcome | null {
  const ai = evidence['ai'];
  if (!ai || typeof ai !== 'object') {
    return null;
  }
  const parsed = aiAssistOutcomeSchema.safeParse((ai as { outcome?: unknown }).outcome);
  return parsed.success ? parsed.data : null;
}

export function toArtifactDto(artifact: Artifact): ArtifactDto {
  return {
    id: artifact.id,
    runId: artifact.runId,
    kind: artifact.kind,
    format: artifact.format,
    fileName: artifact.fileName,
    sizeBytes: artifact.sizeBytes,
    downloadUrl: `/api/v1/artifacts/${artifact.id}/download`,
    createdAt: artifact.createdAt.toISOString(),
  };
}

export function toRuleSetSummaryDto(ruleSet: StoredRuleSet): RuleSetSummaryDto {
  return {
    id: ruleSet.id,
    slug: ruleSet.slug,
    workflowSlug: ruleSet.workflowSlug,
    name: ruleSet.name,
    version: ruleSet.version,
    active: ruleSet.active,
    ruleCount: ruleSet.rules.length,
    createdAt: ruleSet.createdAt.toISOString(),
    updatedAt: ruleSet.updatedAt.toISOString(),
  };
}

export function toRuleSetDto(ruleSet: StoredRuleSet): RuleSetDto {
  return {
    ...toRuleSetSummaryDto(ruleSet),
    rules: ruleSet.rules,
  };
}

export function toWorkflowSummaryDto(workflow: RegisteredWorkflow): WorkflowSummaryDto {
  return {
    id: `wf-${workflow.slug}`,
    slug: workflow.slug,
    name: workflow.name,
    description: workflow.description,
    version: workflow.version,
    steps: workflow.stepSummaries.map((step) => ({ id: step.id, name: step.name })),
    ruleCount: workflow.ruleSet.rules.length,
  };
}

export function toWorkflowDetailDto(workflow: RegisteredWorkflow): WorkflowDetailDto {
  return {
    ...toWorkflowSummaryDto(workflow),
    configFields: workflow.configFields.map((field) => ({ ...field })),
    configuration: {
      datasetRoles: workflow.configuration.datasetRoles.map((role) => ({ ...role })),
      columnRoles: workflow.configuration.columnRoles.map((role) => ({ ...role })),
      options: workflow.configuration.options.map((field) => ({ ...field })),
    },
    ruleSet: {
      slug: workflow.ruleSet.slug,
      name: workflow.ruleSet.name,
      version: workflow.ruleSet.version,
      rules: workflow.ruleSet.rules,
    },
  };
}
