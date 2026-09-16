import { describe, expect, it } from 'vitest';
import {
  REVIEW_FILTER_DEFINITIONS,
  changedFields,
  reviewAutomationFromEvidence,
  reviewFilterDefinition,
  reviewEventsFromEvidence,
  reviewResolutionLogSchema,
  reviewStateForDecision,
  reviewStateForItem,
} from './review.js';

describe('review domain', () => {
  it('derives the human-facing state from the persisted item status', () => {
    expect(reviewStateForItem({ status: 'open', reason: 'no_rule_match' })).toBe('NEEDS_REVIEW');
    expect(reviewStateForItem({ status: 'open', reason: 'ai_failed' })).toBe('ERROR');
    expect(reviewStateForItem({ status: 'resolved_accepted', reason: 'no_rule_match' })).toBe(
      'APPROVED',
    );
    expect(reviewStateForItem({ status: 'resolved_overridden', reason: 'no_rule_match' })).toBe(
      'OVERRIDDEN',
    );
    expect(reviewStateForItem({ status: 'dismissed', reason: 'no_rule_match' })).toBe('DISMISSED');
  });

  it('treats a decision with no review item as auto-resolved', () => {
    expect(reviewStateForDecision(null)).toBe('AUTO_RESOLVED');
    expect(reviewStateForDecision({ status: 'open', reason: 'low_confidence' })).toBe(
      'NEEDS_REVIEW',
    );
  });

  it('exposes one definition per filter preset with the expected sets', () => {
    for (const definition of REVIEW_FILTER_DEFINITIONS) {
      expect(reviewFilterDefinition(definition.key)).toBe(definition);
    }
    expect(reviewFilterDefinition('needs_review').statuses).toEqual(['open']);
    expect(reviewFilterDefinition('conflicts').reasons).toContain('rule_conflict');
    expect(reviewFilterDefinition('processing_errors').reasons).toEqual(['ai_failed']);
    expect(reviewFilterDefinition('overridden').statuses).toEqual(['resolved_overridden']);
  });

  it('reports exactly the fields whose applied value differs from automation', () => {
    expect(
      changedFields({ RootCause: 'Power Loss', Priority: 'High' }, { RootCause: 'Hardware' }),
    ).toEqual(['RootCause', 'Priority']);
    expect(changedFields({ RootCause: 'Power Loss' }, { RootCause: 'Power Loss' })).toEqual([]);
  });

  it('reconstructs the automation block from decision evidence and falls back safely', () => {
    const automation = reviewAutomationFromEvidence(
      {
        decisionSource: 'deterministic',
        confidence: 0.9,
        matchedRuleIds: ['r1'],
        resultingValues: { RootCause: 'Power Loss' },
        ruleStatus: 'matched',
        explanation: 'matched the power rule',
        matchedRules: [
          {
            ruleId: 'r1',
            ruleName: 'Power',
            priority: 10,
            specificity: 1,
            matchedTerm: null,
            confidence: 1,
          },
        ],
      },
      { RootCause: 'fallback' },
    );
    expect(automation.decisionSource).toBe('deterministic');
    expect(automation.values).toEqual({ RootCause: 'Power Loss' });
    expect(automation.applicableRules).toHaveLength(1);

    const fallback = reviewAutomationFromEvidence({}, { RootCause: 'fallback' });
    expect(fallback.decisionSource).toBe('none');
    expect(fallback.confidence).toBeNull();
    expect(fallback.values).toEqual({ RootCause: 'fallback' });
  });

  it('extracts the latest event and earlier history from evidence', () => {
    const { latestEvent, history } = reviewEventsFromEvidence({
      latestFault: { rowIndex: 5, occurredAt: '2026-01-02T00:00:00.000Z', description: 'latest' },
      earlierFaults: [
        {
          rowIndex: 2,
          occurredAt: '2025-12-01T00:00:00.000Z',
          description: 'old',
          rootCause: 'Power Loss',
        },
      ],
    });
    expect(latestEvent?.description).toBe('latest');
    expect(history).toHaveLength(1);
    expect(history[0]?.rootCause).toBe('Power Loss');

    expect(reviewEventsFromEvidence({}).latestEvent).toBeNull();
  });

  it('validates and defaults the append-only resolution audit entry', () => {
    const parsed = reviewResolutionLogSchema.parse({
      id: 'log-1',
      reviewItemId: 'item-1',
      runId: 'run-1',
      entityKey: '1003',
      action: 'overridden',
      previousStatus: 'open',
      resultingState: 'OVERRIDDEN',
      automation: { decisionSource: 'deterministic', values: { RootCause: 'Power Loss' } },
      createdAt: new Date(),
    });
    expect(parsed.appliedValues).toEqual({});
    expect(parsed.changedFields).toEqual([]);
    expect(parsed.resolvedBy).toBeNull();
  });
});
