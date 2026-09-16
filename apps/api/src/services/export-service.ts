import {
  isUnmatchedReviewReasons,
  NotFoundError,
  outputRecordStateForReviewState,
  reviewStateForDecision,
  summariseOutputRecords,
  type Artifact,
  type ExportSummary,
  type Repositories,
} from '@sheetpilot/core';

export type ExportStatus = 'processing' | 'pending_review' | 'ready' | 'failed' | 'unavailable';

export interface ExportValidation {
  validated: boolean;
  rowCount: number;
  columnCount: number;
  validatedAt: Date | null;
}

export interface RunExportStatus {
  runId: string;
  status: ExportStatus;
  ready: boolean;
  message: string;
  summary: ExportSummary;
  artifacts: Artifact[];
  validation: ExportValidation | null;
}

export interface ExportServiceDeps {
  repositories: Repositories;
}

function metricNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The final-deliverable view of a run: a live summary (automation + human decisions), the downloadable
 * artifacts, and whether the generated files were validated at run completion. Nothing is stored
 * here — it is derived from the decision log and the review items so it can never drift.
 */
export class ExportService {
  constructor(private readonly deps: ExportServiceDeps) {}

  async status(runId: string): Promise<RunExportStatus> {
    const run = await this.deps.repositories.runs.getById(runId);
    if (!run) {
      throw new NotFoundError('Run', runId);
    }

    const [decisions, reviewItems, artifacts] = await Promise.all([
      this.deps.repositories.decisions.listByRun(runId),
      this.deps.repositories.reviewItems.listByRun(runId),
      this.deps.repositories.artifacts.listByRun(runId),
    ]);

    const itemByEntity = new Map(reviewItems.map((item) => [item.entityKey, item]));
    const summary = summariseOutputRecords(
      decisions.map((decision) => ({
        state: outputRecordStateForReviewState(
          reviewStateForDecision(itemByEntity.get(decision.entityKey)),
        ),
        unmatched: isUnmatchedReviewReasons(decision.reviewReasons),
      })),
      metricNumber(run.stats['outputRows'], decisions.length),
    );

    const outputs = artifacts.filter(
      (artifact) => artifact.kind === 'output_csv' || artifact.kind === 'output_xlsx',
    );
    const validation: ExportValidation | null =
      run.stats['exportValidated'] === 1
        ? {
            validated: true,
            rowCount: metricNumber(run.stats['exportValidatedRows'], summary.outputRows),
            columnCount: metricNumber(run.stats['exportValidatedColumns'], 0),
            validatedAt: run.finishedAt,
          }
        : null;

    let status: ExportStatus;
    let message: string;
    if (run.status === 'failed') {
      status = 'failed';
      message = run.error ?? 'The run failed before an export could be produced.';
    } else if (run.status !== 'succeeded') {
      status = 'processing';
      message = 'The run is still processing.';
    } else if (outputs.length === 0) {
      status = 'unavailable';
      message = 'No output artifacts were produced.';
    } else if (summary.unresolved > 0 || summary.errors > 0) {
      const pending = summary.unresolved + summary.errors;
      status = 'pending_review';
      message = `${pending} case(s) still need a human decision before the export is final.`;
    } else {
      status = 'ready';
      message = 'All cases resolved; the export reflects the reviewed decisions.';
    }

    return {
      runId,
      status,
      ready: status === 'ready',
      message,
      summary,
      artifacts: outputs,
      validation,
    };
  }
}
