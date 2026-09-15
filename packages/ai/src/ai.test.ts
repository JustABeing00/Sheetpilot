import { describe, expect, it } from 'vitest';
import type { RuleEvaluation } from '@sheetpilot/core';
import { decideAiUsage } from './policy.js';
import { createClassificationProvider } from './factory.js';
import { NoopClassificationProvider } from './noop-provider.js';

function evaluation(partial: Partial<RuleEvaluation>): RuleEvaluation {
  return {
    matchedRuleIds: [],
    winnerRuleId: null,
    confidence: 0,
    explanation: '',
    conflicts: [],
    evaluatedRuleCount: 0,
    ...partial,
  };
}

describe('decideAiUsage', () => {
  it('never consults when the policy is never', () => {
    expect(
      decideAiUsage('never', {
        ruleEvaluation: evaluation({ winnerRuleId: null }),
        confidenceThreshold: 0.8,
      }),
    ).toEqual({
      shouldConsult: false,
      reason: 'policy_never',
    });
  });

  it('always consults when the policy is always', () => {
    const decision = decideAiUsage('always', {
      ruleEvaluation: evaluation({ winnerRuleId: 'r', confidence: 1 }),
      confidenceThreshold: 0.8,
    });
    expect(decision.shouldConsult).toBe(true);
  });

  it('consults only without a rule match for on_no_rule_match', () => {
    expect(
      decideAiUsage('on_no_rule_match', {
        ruleEvaluation: evaluation({ winnerRuleId: null }),
        confidenceThreshold: 0.8,
      }).shouldConsult,
    ).toBe(true);

    expect(
      decideAiUsage('on_no_rule_match', {
        ruleEvaluation: evaluation({ winnerRuleId: 'rule-1', confidence: 0.9 }),
        confidenceThreshold: 0.8,
      }).shouldConsult,
    ).toBe(false);
  });

  it('consults below the confidence threshold for on_low_confidence', () => {
    expect(
      decideAiUsage('on_low_confidence', {
        ruleEvaluation: evaluation({ winnerRuleId: 'rule-1', confidence: 0.5 }),
        confidenceThreshold: 0.8,
      }),
    ).toEqual({ shouldConsult: true, reason: 'low_confidence' });

    expect(
      decideAiUsage('on_low_confidence', {
        ruleEvaluation: evaluation({ winnerRuleId: 'rule-1', confidence: 0.9 }),
        confidenceThreshold: 0.8,
      }).shouldConsult,
    ).toBe(false);
  });
});

describe('createClassificationProvider', () => {
  it('returns the noop provider by default', () => {
    const provider = createClassificationProvider({ provider: 'noop', apiKey: null, model: null });
    expect(provider).toBeInstanceOf(NoopClassificationProvider);
    expect(provider.isAvailable()).toBe(false);
  });

  it('fails fast for unimplemented providers', () => {
    expect(() =>
      createClassificationProvider({ provider: 'openai', apiKey: 'key', model: 'gpt' }),
    ).toThrow('not implemented');
  });
});

describe('NoopClassificationProvider', () => {
  it('returns no suggestions', async () => {
    const provider = new NoopClassificationProvider();
    await expect(
      provider.classify({
        text: 'no power',
        accountKey: null,
        taxonomy: [{ code: 'POWER', label: 'Power', description: '', category: null }],
        hints: {},
      }),
    ).resolves.toEqual([]);
  });
});
