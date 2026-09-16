import type {
  EvaluatedCondition,
  Rule,
  RuleConflict,
  RuleEvaluation,
  RuleMatchSummary,
  RuleReviewReason,
  RuleSet,
} from '@sheetpilot/core';
import {
  countLeafConditions,
  evaluateConditionsDetailed,
  findMatchedTerm,
  type RuleContext,
} from './conditions.js';
import { applyActions } from './actions.js';
import { renderTemplate } from './template.js';

export interface RuleMatch {
  rule: Rule;
  matchedTerm: string | null;
  specificity: number;
  conditions: EvaluatedCondition[];
}

export interface RuleEvaluationOptions {
  /** Classifications whose confidence is strictly below this threshold are flagged for review. */
  minConfidence?: number;
  /** When true (default) a context with no matching rule is flagged `no_rule_match`. */
  reviewOnNoMatch?: boolean;
  /** When true (default) equal-priority rules that disagree are flagged `rule_conflict`. */
  reviewOnConflict?: boolean;
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

/**
 * Detects disagreements between rules of the *same priority* — the only rules that cannot be ordered.
 * A lower-priority rule losing to a higher-priority one is the intended fallback hierarchy, not a
 * conflict. When two equally-ranked rules assign different values to the same output field, the winner
 * is still chosen deterministically (by specificity then id) but `rule_conflict` is raised so a human
 * reviews the case; the engine never silently guesses.
 */
function collectConflicts(matched: RuleMatch[], winner: Rule): RuleConflict[] {
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

  const conflicts: RuleConflict[] = [];
  for (const [field, entries] of byField) {
    const distinct = [...new Set(entries.map((entry) => entry.value))];
    if (distinct.length > 1) {
      conflicts.push({
        ruleIds: [...new Set(entries.map((entry) => entry.ruleId))],
        field,
        values: distinct,
        reason: `Rules with priority ${winner.priority} set '${field}' to different values: ${distinct.join(' vs ')}`,
      });
    }
  }

  return conflicts;
}

function toMatchSummary(match: RuleMatch): RuleMatchSummary {
  return {
    ruleId: match.rule.id,
    ruleName: match.rule.name,
    priority: match.rule.priority,
    specificity: match.specificity,
    matchedTerm: match.matchedTerm,
    confidence: match.rule.confidence,
  };
}

export function evaluateRules(
  rules: Rule[],
  context: RuleContext,
  options: RuleEvaluationOptions = {},
): RuleEvaluationResult {
  const minConfidence = options.minConfidence ?? 0;
  const reviewOnNoMatch = options.reviewOnNoMatch ?? true;
  const reviewOnConflict = options.reviewOnConflict ?? true;

  const matched: RuleMatch[] = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    const detail = evaluateConditionsDetailed(rule.when, context);
    if (detail.matched) {
      matched.push({
        rule,
        matchedTerm: findMatchedTerm(rule.when, context),
        specificity: countLeafConditions(rule.when),
        conditions: detail.conditions,
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

  const conflicts = winner ? collectConflicts(sorted, winner) : [];
  const resultingValues = winner ? applyActions(winner.then, {}).values : {};

  const reviewReasons: RuleReviewReason[] = [];
  if (!winner && reviewOnNoMatch) {
    reviewReasons.push('no_rule_match');
  }
  if (conflicts.length > 0 && reviewOnConflict) {
    reviewReasons.push('rule_conflict');
  }
  if (winner && winner.confidence < minConfidence) {
    reviewReasons.push('low_confidence');
  }

  const evaluation: RuleEvaluation = {
    matchedRuleIds: sorted.map((match) => match.rule.id),
    winnerRuleId: winner?.id ?? null,
    winnerPriority: winner?.priority ?? null,
    confidence: winner ? winner.confidence : 0,
    status: winner ? 'matched' : 'no_match',
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    explanation,
    conflicts,
    conditions: winnerMatch?.conditions ?? [],
    resultingValues,
    matchedRules: sorted.map(toMatchSummary),
    evaluatedRuleCount: rules.length,
  };

  return { evaluation, winner, matched: sorted };
}

export function evaluateRuleSet(
  ruleSet: RuleSet | { rules: Rule[] },
  context: RuleContext,
  options?: RuleEvaluationOptions,
): RuleEvaluationResult {
  return evaluateRules(ruleSet.rules, context, options);
}
