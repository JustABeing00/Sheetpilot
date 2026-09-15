import type { Rule, RuleSet } from '@sheetpilot/core';
import { collectLeafConditions } from './conditions.js';

export interface RuleValidationIssue {
  level: 'error' | 'warning';
  message: string;
  ruleId?: string;
}

const REQUIRES_VALUE: ReadonlySet<string> = new Set([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches_regex',
  'gt',
  'gte',
  'lt',
  'lte',
]);

export function validateRule(rule: Rule): RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];
  const leaves = collectLeafConditions(rule.when);

  if (leaves.length === 0) {
    issues.push({ level: 'error', message: 'Rule has no conditions', ruleId: rule.id });
  }

  for (const leaf of leaves) {
    if (REQUIRES_VALUE.has(leaf.operator) && (leaf.value === null || leaf.value === '')) {
      issues.push({
        level: 'error',
        message: `Operator '${leaf.operator}' on field '${leaf.field}' requires a value`,
        ruleId: rule.id,
      });
    }
    if ((leaf.operator === 'in' || leaf.operator === 'not_in') && !Array.isArray(leaf.value)) {
      issues.push({
        level: 'error',
        message: `Operator '${leaf.operator}' on field '${leaf.field}' requires an array value`,
        ruleId: rule.id,
      });
    }
    if (leaf.operator === 'matches_regex' && typeof leaf.value === 'string') {
      try {
        new RegExp(leaf.value);
      } catch {
        issues.push({
          level: 'error',
          message: `Invalid regular expression '${leaf.value}'`,
          ruleId: rule.id,
        });
      }
    }
  }

  if (rule.explanationTemplate.trim().length === 0) {
    issues.push({
      level: 'warning',
      message: 'Rule has no explanation template; a generic explanation will be used',
      ruleId: rule.id,
    });
  }

  return issues;
}

export function validateRuleSet(ruleSet: RuleSet | { rules: Rule[] }): RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];
  const seen = new Set<string>();

  for (const rule of ruleSet.rules) {
    if (seen.has(rule.id)) {
      issues.push({ level: 'error', message: `Duplicate rule id '${rule.id}'`, ruleId: rule.id });
      continue;
    }
    seen.add(rule.id);
    issues.push(...validateRule(rule));
  }

  if (issues.every((issue) => issue.level !== 'error') && ruleSet.rules.length === 0) {
    issues.push({ level: 'warning', message: 'Rule set is empty' });
  }

  return issues;
}
