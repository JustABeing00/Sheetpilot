import { describe, expect, it } from 'vitest';
import { ruleSchema, type Rule } from '@sheetpilot/core';
import { evaluateCondition, findMatchedTerm, type RuleContext } from './conditions.js';
import { evaluateRules } from './evaluate.js';
import { applyActions } from './actions.js';
import { validateRuleSet } from './validate.js';

function makeRule(partial: Record<string, unknown>): Rule {
  return ruleSchema.parse(partial);
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
        { field: 'description', operator: 'contains', value: 'no power', caseSensitive: false },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'description', operator: 'contains', value: 'No Power', caseSensitive: false },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'description', operator: 'contains', value: 'No Power', caseSensitive: true },
        context,
      ),
    ).toBe(false);
  });

  it('coerces numeric strings for comparisons', () => {
    expect(
      evaluateCondition(
        { field: 'faultCount', operator: 'gt', value: '2', caseSensitive: false },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'faultCount', operator: 'lte', value: 2, caseSensitive: false },
        context,
      ),
    ).toBe(false);
  });

  it('compares dates as timestamps', () => {
    expect(
      evaluateCondition(
        { field: 'occurredAt', operator: 'lt', value: '2026-03-05', caseSensitive: false },
        context,
      ),
    ).toBe(true);
  });

  it('supports membership and emptiness checks', () => {
    expect(
      evaluateCondition(
        { field: 'account', operator: 'in', value: ['A-100', 'B-200'], caseSensitive: false },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'account', operator: 'not_in', value: ['B-200'], caseSensitive: false },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'missing', operator: 'is_empty', value: null, caseSensitive: false },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'account', operator: 'is_not_empty', value: null, caseSensitive: false },
        context,
      ),
    ).toBe(true);
  });

  it('handles regex safely, including invalid patterns', () => {
    expect(
      evaluateCondition(
        {
          field: 'description',
          operator: 'matches_regex',
          value: 'power\\s+detected',
          caseSensitive: false,
        },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        {
          field: 'description',
          operator: 'matches_regex',
          value: '([unclosed',
          caseSensitive: false,
        },
        context,
      ),
    ).toBe(false);
  });

  it('finds the matched term for explanations', () => {
    const term = findMatchedTerm(
      {
        mode: 'all',
        conditions: [
          { field: 'description', operator: 'contains', value: 'no power', caseSensitive: false },
        ],
      },
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

  it('picks the highest priority enabled rule', () => {
    const result = evaluateRules(rules, context);

    expect(result.winner?.id).toBe('power-loss');
    expect(result.evaluation.matchedRuleIds).toEqual(['power-loss']);
    expect(result.evaluation.confidence).toBe(0.95);
    expect(result.evaluation.explanation).toBe('Term "no power" maps to Power Loss');
  });

  it('returns no winner and zero confidence when nothing matches', () => {
    const result = evaluateRules(rules, { description: 'mystery alarm' });
    expect(result.winner).toBeNull();
    expect(result.evaluation.confidence).toBe(0);
    expect(result.evaluation.explanation).toBe('');
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
