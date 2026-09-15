import type { OutputValue, RuleAction } from '@sheetpilot/core';

export interface AppliedAction {
  ruleId: string | null;
  field: string;
  value: OutputValue;
  type: 'set' | 'set_if_empty';
  skipped: boolean;
}

export interface ApplyActionsResult {
  values: Record<string, OutputValue>;
  applied: AppliedAction[];
}

function isEmptyValue(value: OutputValue | undefined): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

export function applyActions(
  actions: RuleAction[],
  target: Record<string, OutputValue>,
  options: { ruleId?: string | null } = {},
): ApplyActionsResult {
  const values: Record<string, OutputValue> = { ...target };
  const applied: AppliedAction[] = [];

  for (const action of actions) {
    if (action.type === 'set_if_empty' && !isEmptyValue(values[action.field])) {
      applied.push({
        ruleId: options.ruleId ?? null,
        field: action.field,
        value: values[action.field] ?? null,
        type: action.type,
        skipped: true,
      });
      continue;
    }

    values[action.field] = action.value;
    applied.push({
      ruleId: options.ruleId ?? null,
      field: action.field,
      value: action.value,
      type: action.type,
      skipped: false,
    });
  }

  return { values, applied };
}
