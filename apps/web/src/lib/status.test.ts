import { describe, expect, it } from 'vitest';
import {
  decisionSourceLabel,
  describeRunError,
  reviewReasonHelp,
  reviewReasonLabel,
  reviewStateLabel,
  reviewStateTone,
  runStatusLabel,
  severityLabel,
  stepStatusLabel,
} from './status.js';

describe('status labels', () => {
  it('uses plain language for run status', () => {
    expect(runStatusLabel('running')).toBe('Processing');
    expect(runStatusLabel('succeeded')).toBe('Finished');
    expect(runStatusLabel('failed')).toBe('Failed');
  });

  it('labels derived review states without leaking tokens', () => {
    expect(reviewStateLabel('AUTO_RESOLVED')).toBe('Automated');
    expect(reviewStateLabel('NEEDS_REVIEW')).toBe('Needs review');
    expect(reviewStateLabel('OVERRIDDEN')).toBe('Overridden');
    expect(reviewStateLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('labels review reasons with spaces, not underscores', () => {
    for (const reason of [
      'no_events',
      'no_rule_match',
      'rule_conflict',
      'low_confidence',
      'ambiguous_latest_timestamp',
      'duplicate_primary_key',
      'ai_proposed_alternative',
      'ai_failed',
    ]) {
      const label = reviewReasonLabel(reason);
      expect(label).not.toContain('_');
      expect(label.length).toBeGreaterThan(0);
      expect(reviewReasonHelp(reason).length).toBeGreaterThan(0);
    }
  });

  it('falls back to a readable label for an unknown reason', () => {
    expect(reviewReasonLabel('some_new_reason')).toBe('some new reason');
    expect(reviewReasonHelp('some_new_reason')).toMatch(/override/i);
  });

  it('labels decision sources and severities', () => {
    expect(decisionSourceLabel('deterministic')).toBe('Rule-based');
    expect(decisionSourceLabel('ai_suggested')).toBe('AI-assisted');
    expect(severityLabel('critical')).toBe('Urgent');
    expect(stepStatusLabel('running')).toBe('Running');
  });

  it('keeps tone mapping independent of the labels', () => {
    expect(reviewStateTone('NEEDS_REVIEW')).toBe('warning');
    expect(reviewStateTone('APPROVED')).toBe('success');
  });

  it('explains common run failures in actionable terms', () => {
    expect(describeRunError('Column "Account" is missing')).toMatch(/setup/i);
    expect(describeRunError('Workflow is not registered')).toMatch(/not available/i);
    expect(describeRunError('Something unexpected')).toBe('Something unexpected');
  });
});
