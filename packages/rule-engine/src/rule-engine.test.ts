import { describe, expect, it } from 'vitest';
import {
  ruleConditionSchema,
  ruleSchema,
  type ConditionNode,
  type Rule,
  type RuleCondition,
} from '@sheetpilot/core';
import { evaluateCondition, findMatchedTerm, type RuleContext } from './conditions.js';
import { evaluateRules } from './evaluate.js';
import { applyActions } from './actions.js';
import { validateRuleSet } from './validate.js';

function condition(partial: Record<string, unknown>): RuleCondition {
  return ruleConditionSchema.parse(partial);
}

function makeRule(partial: Record<string, unknown>): Rule {
  return ruleSchema.parse(partial);
}

function group(mode: 'all' | 'any', conditions: ConditionNode[]): ConditionNode {
  return { mode, conditions };
}

const context: RuleContext = {
  account: 'A-100',
  description: 'No power detected at site',
  faultCount: 3,
  occurredAt: '2026-03-04T10:00:00Z',
};

describe('evaluateCondition', () => {
  it('matches contains case-insensitively by default', () => {
    expect(
      evaluateCondition(
        condition({ field: 'description', operator: 'contains', value: 'no power' }),
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        condition({
          field: 'description',
          operator: 'contains',
          value: 'No Power',
          caseSensitive: false,
        }),
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        condition({
          field: 'description',
          operator: 'contains',
          value: 'No Power',
          caseSensitive: true,
        }),
        context,
      ),
    ).toBe(false);
  });

  it('coerces numeric strings for comparisons', () => {
    expect(
      evaluateCondition(condition({ field: 'faultCount', operator: 'gt', value: '2' }), context),
    ).toBe(true);
    expect(
      evaluateCondition(condition({ field: 'faultCount', operator: 'lte', value: 2 }), context),
    ).toBe(false);
  });

  it('compares dates as timestamps', () => {
    expect(
      evaluateCondition(
        condition({ field: 'occurredAt', operator: 'lt', value: '2026-03-05' }),
        context,
      ),
    ).toBe(true);
  });

  it('supports membership and emptiness checks', () => {
    expect(
      evaluateCondition(
        condition({ field: 'account', operator: 'in', value: ['A-100', 'B-200'] }),
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        condition({ field: 'account', operator: 'not_in', value: ['B-200'] }),
        context,
      ),
    ).toBe(true);
    expect(evaluateCondition(condition({ field: 'missing', operator: 'is_empty' }), context)).toBe(
      true,
    );
    expect(
      evaluateCondition(condition({ field: 'account', operator: 'is_not_empty' }), context),
    ).toBe(true);
  });

  it('handles regex safely, including invalid patterns', () => {
    expect(
      evaluateCondition(
        condition({
          field: 'description',
          operator: 'matches_regex',
          value: 'power\\s+detected',
        }),
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        condition({ field: 'description', operator: 'matches_regex', value: '([unclosed' }),
        context,
      ),
    ).toBe(false);
  });

  it('evaluates conditions over the latest record by default', () => {
    const scoped = condition({ field: 'description', operator: 'contains', value: 'no power' });
    expect(scoped.scope).toBe('latest');
    expect(evaluateCondition(scoped, context)).toBe(true);
  });

  it('evaluates any_event / all_events scopes over the event history', () => {
    const historyContext: RuleContext = {
      description: 'power restored',
      events: [
        { description: 'power restored' },
        { description: 'communication lost' },
        { description: 'communication lost again' },
      ],
    };

    const anyEvent = condition({
      field: 'description',
      operator: 'contains',
      value: 'communication lost',
      scope: 'any_event',
    });
    expect(evaluateCondition(anyEvent, historyContext)).toBe(true);

    const allEvents = condition({
      field: 'description',
      operator: 'contains',
      value: 'communication lost',
      scope: 'all_events',
    });
    expect(evaluateCondition(allEvents, historyContext)).toBe(false);

    const allRestored = condition({
      field: 'description',
      operator: 'contains',
      value: 'power restored',
      scope: 'all_events',
    });
    expect(
      evaluateCondition(allRestored, {
        events: [{ description: 'power restored' }, { description: 'power restored' }],
      }),
    ).toBe(true);

    expect(evaluateCondition(anyEvent, { events: [] })).toBe(false);
    expect(evaluateCondition(allEvents, { events: [] })).toBe(false);
    expect(evaluateCondition(anyEvent, context)).toBe(false);
  });

  it('finds the matched term for explanations', () => {
    const term = findMatchedTerm(
      group('all', [condition({ field: 'description', operator: 'contains', value: 'no power' })]),
      context,
    );
    expect(term).toBe('no power');
  });
});

describe('evaluateRules', () => {
  const rules: Rule[] = [
    makeRule({
      id: 'generic-fault',
      name: 'Generic fault',
      priority: 10,
      when: { conditions: [{ field: 'description', operator: 'contains', value: 'fault' }] },
      then: [{ field: 'rootCause', value: 'Unspecified Fault' }],
      confidence: 0.6,
    }),
    makeRule({
      id: 'power-loss',
      name: 'Power loss',
      priority: 100,
      when: { conditions: [{ field: 'description', operator: 'contains', value: 'no power' }] },
      then: [
        { field: 'rootCause', value: 'Power Loss' },
        { field: 'priority', value: 'P2' },
      ],
      confidence: 0.95,
      explanationTemplate: 'Term "{matchedTerm}" maps to Power Loss',
    }),
    makeRule({
      id: 'disabled-rule',
      name: 'Disabled rule',
      priority: 500,
      enabled: false,
      when: { conditions: [{ field: 'description', operator: 'contains', value: 'no power' }] },
      then: [{ field: 'rootCause', value: 'Never' }],
    }),
  ];

  it('picks the highest priority enabled rule and reports full decision metadata', () => {
    const result = evaluateRules(rules, context);

    expect(result.winner?.id).toBe('power-loss');
    expect(result.evaluation.matchedRuleIds).toEqual(['power-loss']);
    expect(result.evaluation.winnerPriority).toBe(100);
    expect(result.evaluation.confidence).toBe(0.95);
    expect(result.evaluation.status).toBe('matched');
    expect(result.evaluation.explanation).toBe('Term "no power" maps to Power Loss');
    expect(result.evaluation.resultingValues).toEqual({ rootCause: 'Power Loss', priority: 'P2' });
    expect(result.evaluation.conditions).toEqual([
      {
        field: 'description',
        operator: 'contains',
        scope: 'latest',
        expected: 'no power',
        actual: 'No power detected at site',
        matched: true,
      },
    ]);
    expect(result.evaluation.matchedRules.map((entry) => entry.ruleId)).toEqual(['power-loss']);
    expect(result.evaluation.matchedRules[0]?.matchedTerm).toBe('no power');
  });

  it('returns a no-match outcome that needs review', () => {
    const result = evaluateRules(rules, { description: 'mystery alarm' });

    expect(result.winner).toBeNull();
    expect(result.evaluation.status).toBe('no_match');
    expect(result.evaluation.needsReview).toBe(true);
    expect(result.evaluation.reviewReasons).toEqual(['no_rule_match']);
    expect(result.evaluation.confidence).toBe(0);
    expect(result.evaluation.explanation).toBe('');
    expect(result.evaluation.resultingValues).toEqual({});
  });

  it('can suppress the no-match review outcome', () => {
    const result = evaluateRules(
      rules,
      { description: 'mystery alarm' },
      { reviewOnNoMatch: false },
    );
    expect(result.evaluation.needsReview).toBe(false);
    expect(result.evaluation.reviewReasons).toEqual([]);
  });

  it('flags low confidence relative to the configured threshold', () => {
    const lowConfidence = evaluateRules(
      rules.filter((rule) => rule.id === 'generic-fault'),
      { description: 'generic fault detected' },
      { minConfidence: 0.8 },
    );

    expect(lowConfidence.winner?.id).toBe('generic-fault');
    expect(lowConfidence.evaluation.reviewReasons).toEqual(['low_confidence']);
    expect(lowConfidence.evaluation.needsReview).toBe(true);
  });

  it('breaks ties deterministically by specificity then id', () => {
    const tieRules: Rule[] = [
      makeRule({
        id: 'b-rule',
        name: 'B rule',
        priority: 50,
        when: { conditions: [{ field: 'description', operator: 'contains', value: 'power' }] },
        then: [{ field: 'rootCause', value: 'B' }],
      }),
      makeRule({
        id: 'a-rule',
        name: 'A rule',
        priority: 50,
        when: { conditions: [{ field: 'description', operator: 'contains', value: 'power' }] },
        then: [{ field: 'rootCause', value: 'A' }],
      }),
    ];

    expect(evaluateRules(tieRules, context).winner?.id).toBe('a-rule');
    expect(evaluateRules([...tieRules].reverse(), context).winner?.id).toBe('a-rule');
  });

  it('reports conflicts between same-priority matches that disagree', () => {
    const conflictRules: Rule[] = [
      makeRule({
        id: 'x1',
        name: 'X1',
        priority: 50,
        when: { conditions: [{ field: 'description', operator: 'contains', value: 'power' }] },
        then: [{ field: 'rootCause', value: 'Power Loss' }],
      }),
      makeRule({
        id: 'x2',
        name: 'X2',
        priority: 50,
        when: { conditions: [{ field: 'description', operator: 'contains', value: 'no power' }] },
        then: [{ field: 'rootCause', value: 'Sensor Fault' }],
      }),
    ];

    const result = evaluateRules(conflictRules, context);
    expect(result.evaluation.conflicts).toHaveLength(1);
    expect(result.evaluation.conflicts[0]?.field).toBe('rootCause');
    expect(result.evaluation.conflicts[0]?.ruleIds.sort()).toEqual(['x1', 'x2']);
    expect(result.evaluation.conflicts[0]?.values.sort()).toEqual(['Power Loss', 'Sensor Fault']);
    expect(result.evaluation.reviewReasons).toEqual(['rule_conflict']);
    expect(result.evaluation.needsReview).toBe(true);
    // The winner is still deterministic and exposed for traceability.
    expect(result.winner?.id).toBe('x1');
  });

  it('does not treat a lower-priority fallback as a conflict', () => {
    const result = evaluateRules(rules, context);
    expect(result.evaluation.conflicts).toEqual([]);
    expect(result.evaluation.reviewReasons).toEqual([]);
  });
});

describe('applyActions', () => {
  it('sets values and respects set_if_empty', () => {
    const result = applyActions(
      [
        { type: 'set', field: 'rootCause', value: 'Power Loss' },
        { type: 'set_if_empty', field: 'rootCause', value: 'Ignored' },
        { type: 'set_if_empty', field: 'action', value: 'Replace PSU' },
      ],
      {},
      { ruleId: 'r1' },
    );

    expect(result.values).toEqual({ rootCause: 'Power Loss', action: 'Replace PSU' });
    expect(result.applied.map((entry) => entry.skipped)).toEqual([false, true, false]);
  });

  it('does not mutate the input object', () => {
    const target = { rootCause: 'Existing' };
    applyActions([{ type: 'set', field: 'rootCause', value: 'New' }], target);
    expect(target.rootCause).toBe('Existing');
  });
});

describe('validateRuleSet', () => {
  it('detects duplicates, missing values and bad regex', () => {
    const duplicate = makeRule({
      id: 'dup',
      name: 'Duplicate',
      when: { conditions: [{ field: 'a', operator: 'equals', value: 'x' }] },
      then: [{ field: 'out', value: 'y' }],
    });

    const issues = validateRuleSet({
      rules: [
        duplicate,
        duplicate,
        makeRule({
          id: 'missing-value',
          name: 'Missing value',
          when: { conditions: [{ field: 'a', operator: 'contains' }] },
          then: [{ field: 'out', value: 'y' }],
        }),
        makeRule({
          id: 'bad-regex',
          name: 'Bad regex',
          when: { conditions: [{ field: 'a', operator: 'matches_regex', value: '([unclosed' }] },
          then: [{ field: 'out', value: 'y' }],
        }),
      ],
    });

    const errors = issues.filter((issue) => issue.level === 'error');
    expect(errors.some((issue) => issue.message.includes("Duplicate rule id 'dup'"))).toBe(true);
    expect(errors.some((issue) => issue.ruleId === 'missing-value')).toBe(true);
    expect(errors.some((issue) => issue.ruleId === 'bad-regex')).toBe(true);
  });

  it('detects conflicting actions inside a single rule', () => {
    const issues = validateRuleSet({
      rules: [
        makeRule({
          id: 'conflicting-actions',
          name: 'Conflicting actions',
          when: { conditions: [{ field: 'a', operator: 'equals', value: 'x' }] },
          then: [
            { field: 'out', value: 'one' },
            { field: 'out', value: 'two' },
          ],
        }),
      ],
    });

    expect(
      issues.some(
        (issue) =>
          issue.level === 'error' &&
          issue.ruleId === 'conflicting-actions' &&
          issue.message.includes("'out'"),
      ),
    ).toBe(true);
  });

  it('warns about shared priorities and unreachable duplicate conditions', () => {
    const issues = validateRuleSet({
      rules: [
        makeRule({
          id: 'high',
          name: 'High',
          priority: 100,
          when: { conditions: [{ field: 'a', operator: 'contains', value: 'x' }] },
          then: [{ field: 'out', value: 'high' }],
          explanationTemplate: 'high',
        }),
        makeRule({
          id: 'low',
          name: 'Low',
          priority: 50,
          when: { conditions: [{ field: 'a', operator: 'contains', value: 'x' }] },
          then: [{ field: 'out', value: 'low' }],
          explanationTemplate: 'low',
        }),
        makeRule({
          id: 'peer',
          name: 'Peer',
          priority: 100,
          when: { conditions: [{ field: 'b', operator: 'contains', value: 'y' }] },
          then: [{ field: 'out', value: 'peer' }],
          explanationTemplate: 'peer',
        }),
      ],
    });

    expect(
      issues.some(
        (issue) =>
          issue.level === 'warning' && issue.ruleId === 'low' && issue.message.includes("'high'"),
      ),
    ).toBe(true);
    expect(
      issues.some(
        (issue) => issue.level === 'warning' && issue.message.includes('share priority 100'),
      ),
    ).toBe(true);
  });

  it('passes a healthy rule set', () => {
    const issues = validateRuleSet({
      rules: [
        makeRule({
          id: 'ok',
          name: 'OK',
          when: { conditions: [{ field: 'a', operator: 'equals', value: 'x' }] },
          then: [{ field: 'out', value: 'y' }],
          explanationTemplate: 'Matched {matchedTerm}',
        }),
      ],
    });
    expect(issues.filter((issue) => issue.level === 'error')).toHaveLength(0);
  });
});
