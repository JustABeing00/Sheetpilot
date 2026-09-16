import type {
  ConditionNode,
  RuleCondition,
  RuleConditionScope,
  RuleOperator,
} from '@sheetpilot/core';
import { formatCellValue } from './format.js';

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: 'is exactly',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  matches_regex: 'matches pattern',
  in: 'is one of',
  not_in: 'is not one of',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: 'is greater than',
  gte: 'is greater or equal to',
  lt: 'is less than',
  lte: 'is less or equal to',
};

export const CONDITION_SCOPE_LABELS: Record<RuleConditionScope, string> = {
  latest: 'the latest record',
  any_event: 'any record in its history',
  all_events: 'every record in its history',
};

export const OPERATORS_WITHOUT_VALUE = new Set<RuleOperator>(['is_empty', 'is_not_empty']);

export const OPERATORS_WITH_LIST_VALUE = new Set<RuleOperator>(['in', 'not_in']);

function describeLeaf(condition: RuleCondition): string {
  const value = Array.isArray(condition.value)
    ? `[${condition.value.join(', ')}]`
    : formatCellValue(condition.value);
  const scopePrefix =
    condition.scope && condition.scope !== 'latest'
      ? condition.scope === 'any_event'
        ? 'history has a record where '
        : 'history every record where '
      : '';
  if (OPERATORS_WITHOUT_VALUE.has(condition.operator)) {
    return `${scopePrefix}${condition.field} ${OPERATOR_LABELS[condition.operator]}`;
  }
  return `${scopePrefix}${condition.field} ${OPERATOR_LABELS[condition.operator]} ${value}`;
}

export function describeCondition(node: ConditionNode): string {
  if ('mode' in node) {
    const joiner = node.mode === 'all' ? ' AND ' : ' OR ';
    return node.conditions.map((child) => describeCondition(child)).join(joiner);
  }
  return describeLeaf(node);
}
