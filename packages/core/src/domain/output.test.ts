import { describe, expect, it } from 'vitest';
import {
  isUnmatchedReviewReasons,
  outputRecordStateForReviewState,
  summariseOutputRecords,
} from './output.js';

describe('output summary domain', () => {
  it('maps derived review states onto export record states', () => {
    expect(outputRecordStateForReviewState('AUTO_RESOLVED')).toBe('auto_resolved');
    expect(outputRecordStateForReviewState('APPROVED')).toBe('approved');
    expect(outputRecordStateForReviewState('OVERRIDDEN')).toBe('overridden');
    expect(outputRecordStateForReviewState('DISMISSED')).toBe('dismissed');
    expect(outputRecordStateForReviewState('NEEDS_REVIEW')).toBe('needs_review');
    expect(outputRecordStateForReviewState('ERROR')).toBe('error');
    expect(outputRecordStateForReviewState(null)).toBe('auto_resolved');
    expect(outputRecordStateForReviewState(undefined)).toBe('auto_resolved');
  });

  it('classifies review reasons that mean a record was unmatched', () => {
    expect(isUnmatchedReviewReasons(['no_events'])).toBe(true);
    expect(isUnmatchedReviewReasons(['no_rule_match', 'low_confidence'])).toBe(true);
    expect(isUnmatchedReviewReasons(['conflicting_fault_history'])).toBe(false);
    expect(isUnmatchedReviewReasons([])).toBe(false);
  });

  it('aggregates every outcome, grouping human decisions and unmatched records', () => {
    const summary = summariseOutputRecords(
      [
        { state: 'auto_resolved', unmatched: false },
        { state: 'auto_resolved', unmatched: false },
        { state: 'approved', unmatched: false },
        { state: 'overridden', unmatched: true },
        { state: 'dismissed', unmatched: false },
        { state: 'needs_review', unmatched: true },
        { state: 'error', unmatched: false },
      ],
      10,
    );

    expect(summary).toMatchObject({
      totalRecords: 7,
      outputRows: 10,
      autoResolved: 2,
      humanApproved: 1,
      overridden: 1,
      dismissed: 1,
      reviewed: 3,
      unresolved: 1,
      errors: 1,
      unmatched: 2,
    });
    expect(summary.byState).toEqual({
      auto_resolved: 2,
      approved: 1,
      overridden: 1,
      dismissed: 1,
      needs_review: 1,
      error: 1,
    });
  });

  it('defaults output rows to the record count and is order-independent', () => {
    const summary = summariseOutputRecords([
      { state: 'needs_review', unmatched: false },
      { state: 'auto_resolved', unmatched: false },
    ]);

    expect(summary.outputRows).toBe(2);
    expect(summary.totalRecords).toBe(2);
    expect(summary.autoResolved).toBe(1);
    expect(summary.unresolved).toBe(1);
  });
});
