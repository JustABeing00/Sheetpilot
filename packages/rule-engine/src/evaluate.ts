import type { Rule, RuleEvaluation, RuleSet } from '@sheetpilot/core';
import {
  countLeafConditions,
  evaluateConditions,
  findMatchedTerm,
  type RuleContext,
} from './conditions.js';
import { renderTemplate } from './template.js';

export interface RuleMatch {
  rule: Rule;
  matchedTerm: string | null;
  specificity: number;
}

export interface RuleEvaluationResult {
  evaluation: RuleEvaluation;
  winner: Rule | null;
  matched: RuleMatch[];
}

function compareMatches(left: RuleMatch, right: RuleMatch): number {
  if (right.rule.priority !== left.rule.priority) {
    return right.rule.priority - left.rule.priority;
  }
  if (right.specificity !== left.specificity) {
    return right.specificity - left.specificity;
  }
  return left.rule.id.localeCompare(right.rule.id);
}

function collectConflicts(matched: RuleMatch[], winner: Rule): RuleEvaluation['conflicts'] {
  const samePriority = matched.filter((match) => match.rule.priority === winner.priority);
  if (samePriority.length < 2) {
    return [];
  }

  const byField = new Map<string, Array<{ ruleId: string; value: string }>>();
  for (const match of samePriority) {
    for (const action of match.rule.then) {
      const rendered = action.value === null ? '' : String(action.value);
      const entries = byField.get(action.field) ?? [];
      entries.push({ ruleId: match.rule.id, value: rendered });
      byField.set(action.field, entries);
    }
  }

  const conflicts: RuleEvaluation['conflicts'] = [];
  for (const [field, entries] of byField) {
    const distinct = new Set(entries.map((entry) => entry.value));
    if (distinct.size > 1) {
      conflicts.push({
        ruleIds: [...new Set(entries.map((entry) => entry.ruleId))],
        field,
        reason: `Rules with priority ${winner.priority} set '${field}' to different values: ${[
          ...distinct,
        ].join(' vs ')}`,
      });
    }
  }

  return conflicts;
}

export function evaluateRules(rules: Rule[], context: RuleContext): RuleEvaluationResult {
  const matched: RuleMatch[] = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    if (evaluateConditions(rule.when, context)) {
      matched.push({
        rule,
        matchedTerm: findMatchedTerm(rule.when, context),
        specificity: countLeafConditions(rule.when),
      });
    }
  }

  const sorted = [...matched].sort(compareMatches);
  const winnerMatch = sorted[0] ?? null;
  const winner = winnerMatch?.rule ?? null;

  let explanation = '';
  if (winner && winnerMatch) {
    const data: Record<string, unknown> = {
      ...context,
      matchedTerm: winnerMatch.matchedTerm,
      ruleId: winner.id,
      ruleName: winner.name,
      priority: winner.priority,
    };
    explanation =
      winner.explanationTemplate.trim().length > 0
        ? renderTemplate(winner.explanationTemplate, data)
        : `Matched rule '${winner.name}'${winnerMatch.matchedTerm ? ` via term '${winnerMatch.matchedTerm}'` : ''}`;
  }

  const evaluation: RuleEvaluation = {
    matchedRuleIds: sorted.map((match) => match.rule.id),
    winnerRuleId: winner?.id ?? null,
    confidence: winner ? winner.confidence : 0,
    explanation,
    conflicts: winner ? collectConflicts(sorted, winner) : [],
    evaluatedRuleCount: rules.length,
  };

  return { evaluation, winner, matched: sorted };
}

export function evaluateRuleSet(
  ruleSet: RuleSet | { rules: Rule[] },
  context: RuleContext,
): RuleEvaluationResult {
  return evaluateRules(ruleSet.rules, context);
}
