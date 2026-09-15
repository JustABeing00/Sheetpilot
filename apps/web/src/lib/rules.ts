import type { ConditionNode, RuleCondition } from '@sheetpilot/core';
import { formatCellValue } from './format.js';

const OPERATOR_LABELS: Record<RuleCondition['operator'], string> = {
  equals: '=',
  not_equals: '≠',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  matches_regex: 'matches',
  in: 'in',
  not_in: 'not in',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

function describeLeaf(condition: RuleCondition): string {
  const value = Array.isArray(condition.value)
    ? `[${condition.value.join(', ')}]`
    : formatCellValue(condition.value);
  if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') {
    return `${condition.field} ${OPERATOR_LABELS[condition.operator]}`;
  }
  return `${condition.field} ${OPERATOR_LABELS[condition.operator]} ${value}`;
}

export function describeCondition(node: ConditionNode): string {
  if ('mode' in node) {
    const joiner = node.mode === 'all' ? ' AND ' : ' OR ';
    return node.conditions.map((child) => describeCondition(child)).join(joiner);
  }
  return describeLeaf(node);
}
