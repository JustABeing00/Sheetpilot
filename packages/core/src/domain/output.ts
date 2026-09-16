import { z } from 'zod';
import type { ReviewReason } from './enums.js';
import type { ReviewState } from './review.js';

/**
 * The per-record outcome that the export pipeline bakes into the generated file and summarises for
 * the user. It is a flattened, human-facing projection of the derived {@link ReviewState}: one
 * output row can be auto-resolved (automation handled it), human-approved, overridden, dismissed,
 * still waiting for a human, or a processing error where an assistive step failed.
 */
export const outputRecordStateSchema = z.enum([
  'auto_resolved',
  'approved',
  'overridden',
  'dismissed',
  'needs_review',
  'error',
]);
export type OutputRecordState = z.infer<typeof outputRecordStateSchema>;

export const OUTPUT_RECORD_STATE_ORDER: OutputRecordState[] = [
  'auto_resolved',
  'approved',
  'overridden',
  'dismissed',
  'needs_review',
  'error',
];

export const OUTPUT_RECORD_STATE_LABELS: Record<OutputRecordState, string> = {
  auto_resolved: 'Automatically resolved',
  approved: 'Human approved',
  overridden: 'Human overridden',
  dismissed: 'Dismissed',
  needs_review: 'Needs review',
  error: 'Processing error',
};

/**
 * Maps the derived review state onto the export vocabulary. A decision with no review item is
 * `AUTO_RESOLVED` and becomes `auto_resolved`.
 */
export function outputRecordStateForReviewState(
  state: ReviewState | null | undefined,
): OutputRecordState {
  switch (state) {
    case 'APPROVED':
      return 'approved';
    case 'OVERRIDDEN':
      return 'overridden';
    case 'DISMISSED':
      return 'dismissed';
    case 'ERROR':
      return 'error';
    case 'NEEDS_REVIEW':
      return 'needs_review';
    case 'AUTO_RESOLVED':
    case null:
    case undefined:
    default:
      return 'auto_resolved';
  }
}

/**
 * The readiness of the final deliverable for a run. Derived (never stored) so it always reflects the
 * current human decisions: `processing` while the run is still working, `pending_review` once output
 * exists but exceptions remain, `ready` when every case is resolved, plus `failed` and `unavailable`.
 */
export const exportStatusSchema = z.enum([
  'processing',
  'pending_review',
  'ready',
  'failed',
  'unavailable',
]);
export type ExportStatus = z.infer<typeof exportStatusSchema>;

/** Review reasons that mean automation could not connect a record to usable source events. */
export const UNMATCHED_REVIEW_REASONS: readonly ReviewReason[] = ['no_events', 'no_rule_match'];

export function isUnmatchedReviewReasons(reasons: readonly ReviewReason[]): boolean {
  return reasons.some((reason) => UNMATCHED_REVIEW_REASONS.includes(reason));
}

/**
 * The export summary shown before a download. `totalRecords` counts processed entities; `outputRows`
 * is the number of physical rows in the generated file (they differ when the primary file repeats a
 * key). `reviewed` groups every human decision.
 */
export const exportSummarySchema = z.object({
  totalRecords: z.number().int().nonnegative(),
  outputRows: z.number().int().nonnegative(),
  autoResolved: z.number().int().nonnegative(),
  humanApproved: z.number().int().nonnegative(),
  overridden: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  unmatched: z.number().int().nonnegative(),
  byState: z.record(z.string(), z.number().int().nonnegative()),
});
export type ExportSummary = z.infer<typeof exportSummarySchema>;

export interface OutputSummaryInput {
  state: OutputRecordState;
  unmatched: boolean;
}

/**
 * Pure, order-independent aggregation of the per-record outcomes. Both the workflow (as-run) and
 * the API (live, after human decisions) call this so the numbers can never drift.
 */
export function summariseOutputRecords(
  records: ReadonlyArray<OutputSummaryInput>,
  outputRows: number = records.length,
): ExportSummary {
  const byState: Record<string, number> = {};
  for (const state of OUTPUT_RECORD_STATE_ORDER) {
    byState[state] = 0;
  }

  let unmatched = 0;
  for (const record of records) {
    byState[record.state] = (byState[record.state] ?? 0) + 1;
    if (record.unmatched) {
      unmatched += 1;
    }
  }

  const count = (state: OutputRecordState): number => byState[state] ?? 0;
  return {
    totalRecords: records.length,
    outputRows,
    autoResolved: count('auto_resolved'),
    humanApproved: count('approved'),
    overridden: count('overridden'),
    dismissed: count('dismissed'),
    reviewed: count('approved') + count('overridden') + count('dismissed'),
    unresolved: count('needs_review'),
    errors: count('error'),
    unmatched,
    byState,
  };
}
