import type { ConditionNode, Rule, RuleSet, RuleValidationIssue } from '@sheetpilot/core';
import { collectLeafConditions } from './conditions.js';

export type { RuleValidationIssue } from '@sheetpilot/core';

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

const TEXT_OPERATORS: ReadonlySet<string> = new Set([
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
]);

const NUMERIC_OPERATORS: ReadonlySet<string> = new Set(['gt', 'gte', 'lt', 'lte']);

const DATE_LIKE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;

function conditionSignature(node: ConditionNode): string {
  if ('mode' in node) {
    return `${node.mode}(${node.conditions.map(conditionSignature).join('|')})`;
  }
  return `${node.scope ?? 'latest'}:${node.field}:${node.operator}:${JSON.stringify(node.value)}:${node.caseSensitive}`;
}

function isNumericLiteral(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    return value.trim().length > 0 && !Number.isNaN(Number(value));
  }
  return false;
}

function validateActions(rule: Rule, issues: RuleValidationIssue[]): void {
  const byField = new Map<string, string[]>();
  for (const action of rule.then) {
    const rendered = action.value === null ? '' : String(action.value);
    if (action.type === 'set') {
      const entries = byField.get(action.field) ?? [];
      entries.push(rendered);
      byField.set(action.field, entries);
    }
  }
  for (const [field, values] of byField) {
    const distinct = [...new Set(values)];
    if (distinct.length > 1) {
      issues.push({
        level: 'error',
        message: `Rule sets output field '${field}' to conflicting values: ${distinct.join(' vs ')}`,
        ruleId: rule.id,
      });
    }
  }
}

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
    if (Array.isArray(leaf.value) && leaf.value.length === 0) {
      issues.push({
        level: 'error',
        message: `Operator '${leaf.operator}' on field '${leaf.field}' has an empty list of values`,
        ruleId: rule.id,
      });
    }
    if (TEXT_OPERATORS.has(leaf.operator) && leaf.value === '') {
      issues.push({
        level: 'warning',
        message: `Operator '${leaf.operator}' on field '${leaf.field}' has an empty search text and will never match`,
        ruleId: rule.id,
      });
    }
    if (
      NUMERIC_OPERATORS.has(leaf.operator) &&
      leaf.value !== null &&
      !Array.isArray(leaf.value) &&
      !isNumericLiteral(leaf.value) &&
      !(typeof leaf.value === 'string' && DATE_LIKE.test(leaf.value))
    ) {
      issues.push({
        level: 'warning',
        message: `Operator '${leaf.operator}' on field '${leaf.field}' compares against '${String(
          leaf.value,
        )}', which is neither numeric nor a date`,
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

  validateActions(rule, issues);

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
  const byPriority = new Map<number, string[]>();
  const bySignature = new Map<string, Array<{ id: string; priority: number }>>();

  for (const rule of ruleSet.rules) {
    if (seen.has(rule.id)) {
      issues.push({ level: 'error', message: `Duplicate rule id '${rule.id}'`, ruleId: rule.id });
      continue;
    }
    seen.add(rule.id);
    issues.push(...validateRule(rule));

    if (rule.enabled) {
      const peers = byPriority.get(rule.priority) ?? [];
      peers.push(rule.id);
      byPriority.set(rule.priority, peers);

      const signature = conditionSignature(rule.when);
      const signatures = bySignature.get(signature) ?? [];
      signatures.push({ id: rule.id, priority: rule.priority });
      bySignature.set(signature, signatures);
    }
  }

  for (const [priority, ids] of byPriority) {
    if (ids.length > 1) {
      issues.push({
        level: 'warning',
        message: `Rules ${ids.join(', ')} share priority ${priority}; ties are broken by specificity then rule id and any disagreement is flagged for review`,
      });
    }
  }

  for (const signatures of bySignature.values()) {
    if (signatures.length < 2) {
      continue;
    }
    const sorted = [...signatures].sort((left, right) => right.priority - left.priority);
    for (const loser of sorted.slice(1)) {
      issues.push({
        level: 'warning',
        message: `Rule '${loser.id}' has identical conditions to rule '${sorted[0]!.id}' but lower priority, so it can never win`,
        ruleId: loser.id,
      });
    }
  }

  if (issues.every((issue) => issue.level !== 'error') && ruleSet.rules.length === 0) {
    issues.push({ level: 'warning', message: 'Rule set is empty' });
  }

  return issues;
}
