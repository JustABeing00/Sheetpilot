import type {
  ConditionNode,
  EvaluatedCondition,
  RuleCondition,
  RuleConditionScope,
} from '@sheetpilot/core';

export type RuleContext = Record<string, unknown>;

/**
 * Key under which callers may pass the entity's event history (latest-first or not, order does not
 * matter for evaluation). Conditions with scope `any_event`/`all_events` read their field from every
 * entry of this array.
 */
export const HISTORY_CONTEXT_KEY = 'events';

export type Comparable = string | number | boolean | null;

export function normalizeComparable(value: unknown, caseSensitive = false): Comparable {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  const text = toText(value).trim();
  if (text.length === 0) {
    return null;
  }
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) {
    return Number(text);
  }
  return caseSensitive ? text : text.toLowerCase();
}

export function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toText(entry)).join(',');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value) ?? '';
  }
  return '';
}

function looseEquals(left: Comparable, right: Comparable): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left === right;
  }
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return String(left) === String(right);
  }
  return String(left) === String(right);
}

function asText(value: Comparable): string {
  return value === null ? '' : String(value);
}

function asNumber(value: Comparable): number | null {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return null;
}

function tryParseDate(value: Comparable): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function asHistory(context: RuleContext): RuleContext[] {
  const history = context[HISTORY_CONTEXT_KEY];
  if (!Array.isArray(history)) {
    return [];
  }
  return history.filter(
    (entry): entry is RuleContext => typeof entry === 'object' && entry !== null,
  );
}

function scopeOf(condition: RuleCondition): RuleConditionScope {
  return condition.scope ?? 'latest';
}

/** Evaluates a single leaf against one raw field value. */
function matchLeaf(condition: RuleCondition, raw: unknown): boolean {
  const caseSensitive = condition.caseSensitive;
  const left = normalizeComparable(raw, caseSensitive);
  const operand = condition.value;

  switch (condition.operator) {
    case 'is_empty':
      return left === null;
    case 'is_not_empty':
      return left !== null;
    case 'equals':
      return looseEquals(left, normalizeComparable(operand, caseSensitive));
    case 'not_equals':
      return !looseEquals(left, normalizeComparable(operand, caseSensitive));
    case 'contains': {
      if (left === null) {
        return false;
      }
      const needle = asText(normalizeComparable(operand, caseSensitive));
      return needle.length > 0 && asText(left).includes(needle);
    }
    case 'not_contains': {
      if (left === null) {
        return true;
      }
      const needle = asText(normalizeComparable(operand, caseSensitive));
      return needle.length === 0 || !asText(left).includes(needle);
    }
    case 'starts_with': {
      if (left === null) {
        return false;
      }
      const needle = asText(normalizeComparable(operand, caseSensitive));
      return needle.length > 0 && asText(left).startsWith(needle);
    }
    case 'ends_with': {
      if (left === null) {
        return false;
      }
      const needle = asText(normalizeComparable(operand, caseSensitive));
      return needle.length > 0 && asText(left).endsWith(needle);
    }
    case 'matches_regex': {
      if (left === null || typeof operand !== 'string' || operand.length === 0) {
        return false;
      }
      try {
        return new RegExp(operand, caseSensitive ? '' : 'i').test(asText(left));
      } catch {
        return false;
      }
    }
    case 'in':
    case 'not_in': {
      if (!Array.isArray(operand)) {
        return false;
      }
      const candidates = operand.map((entry) => normalizeComparable(entry, caseSensitive));
      const matched = candidates.some((candidate) => looseEquals(left, candidate));
      return condition.operator === 'in' ? matched : !matched;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const leftNumber = asNumber(left);
      const rightNumber = asNumber(normalizeComparable(operand, caseSensitive));
      const leftDate = leftNumber === null ? tryParseDate(left) : null;
      const rightDate =
        rightNumber === null ? tryParseDate(normalizeComparable(operand, caseSensitive)) : null;

      const compare = (a: number, b: number): boolean => {
        switch (condition.operator) {
          case 'gt':
            return a > b;
          case 'gte':
            return a >= b;
          case 'lt':
            return a < b;
          case 'lte':
            return a <= b;
          default:
            return false;
        }
      };

      if (leftNumber !== null && rightNumber !== null) {
        return compare(leftNumber, rightNumber);
      }
      if (leftDate !== null && rightDate !== null) {
        return compare(leftDate, rightDate);
      }
      if (left !== null) {
        const comparison = asText(left).localeCompare(
          asText(normalizeComparable(operand, caseSensitive)),
        );
        return compare(comparison, 0);
      }
      return false;
    }
    default:
      return false;
  }
}

export interface ConditionDetail {
  matched: boolean;
  actual: unknown;
}

/**
 * Evaluates a leaf condition honouring its scope. For history scopes the field is read from every
 * entry of `context.events`; `any_event` passes on the first match, `all_events` requires a non-empty
 * history in which every entry matches.
 */
export function evaluateConditionDetail(
  condition: RuleCondition,
  context: RuleContext,
): ConditionDetail {
  const scope = scopeOf(condition);

  if (scope === 'latest') {
    const actual = context[condition.field];
    return { matched: matchLeaf(condition, actual), actual };
  }

  const history = asHistory(context);
  if (history.length === 0) {
    return { matched: false, actual: null };
  }

  const values = history.map((entry) => entry[condition.field]);
  const matches = values.map((value) => matchLeaf(condition, value));

  if (scope === 'any_event') {
    const index = matches.findIndex(Boolean);
    return { matched: index !== -1, actual: values[index] ?? null };
  }

  return { matched: matches.every(Boolean), actual: null };
}

export function evaluateCondition(condition: RuleCondition, context: RuleContext): boolean {
  return evaluateConditionDetail(condition, context).matched;
}

export interface ConditionsEvaluation {
  matched: boolean;
  conditions: EvaluatedCondition[];
}

/**
 * Evaluates a condition tree and returns both the boolean outcome and a flat, ordered trace of every
 * leaf condition that was inspected — this is the "conditions evaluated" evidence a reviewer sees.
 */
export function evaluateConditionsDetailed(
  node: ConditionNode,
  context: RuleContext,
): ConditionsEvaluation {
  if ('mode' in node) {
    const children = node.conditions.map((child) => evaluateConditionsDetailed(child, context));
    return {
      matched:
        node.mode === 'all'
          ? children.every((child) => child.matched)
          : children.some((child) => child.matched),
      conditions: children.flatMap((child) => child.conditions),
    };
  }

  const detail = evaluateConditionDetail(node, context);
  return {
    matched: detail.matched,
    conditions: [
      {
        field: node.field,
        operator: node.operator,
        scope: scopeOf(node),
        expected: node.value,
        actual: detail.actual,
        matched: detail.matched,
      },
    ],
  };
}

export function evaluateConditions(node: ConditionNode, context: RuleContext): boolean {
  return evaluateConditionsDetailed(node, context).matched;
}

export function collectLeafConditions(node: ConditionNode): RuleCondition[] {
  if ('mode' in node) {
    return node.conditions.flatMap((child) => collectLeafConditions(child));
  }
  return [node];
}

export function countLeafConditions(node: ConditionNode): number {
  return collectLeafConditions(node).length;
}

export function findMatchedTerm(node: ConditionNode, context: RuleContext): string | null {
  if ('mode' in node) {
    const children = node.conditions.map((child) => findMatchedTerm(child, context));
    const first = children.find((value) => value !== null);
    return first ?? null;
  }
  if (!evaluateCondition(node, context)) {
    return null;
  }
  if (typeof node.value === 'string' && node.value.length > 0) {
    return node.value;
  }
  const raw = context[node.field];
  return raw === null || raw === undefined ? null : toText(raw);
}
