import type {
  ColumnRoleDefinition,
  ConfigurationIssue,
  DatasetColumn,
  DatasetSummaryDto,
  WorkflowConfigurationDto,
} from '@sheetpilot/core';
import type { BadgeTone } from './status.js';

const DESCRIPTION_HINTS = /desc|fault|comment|note|detail|reason|message|symptom/i;
const TIMESTAMP_HINTS = /date|time|when|occurred|reported|logged/i;
const IDENTIFIER_HINTS = /account|entity|customer|policy|member|number|^id$| id|ref|code/i;

export function datasetLabel(dataset: DatasetSummaryDto): string {
  return `${dataset.originalName} · ${dataset.rowCount.toLocaleString()}${
    dataset.rowCountExact ? '' : '+'
  } rows`;
}

/**
 * Suggest a sensible default column for a semantic role from the observed dataset profile. Heuristics are
 * deliberately conservative: inferred flags first, then column-name hints, then a populated fallback.
 */
export function suggestColumnName(
  role: ColumnRoleDefinition,
  columns: DatasetColumn[],
  used: Set<string>,
): string | null {
  const populated = columns.filter((column) => column.type !== 'empty');
  const available = populated.filter((column) => !used.has(column.name));
  const fallbackPool = available.length > 0 ? available : populated;

  switch (role.semantic) {
    case 'identifier': {
      const match =
        available.find((column) => column.likelyIdentifier) ??
        available.find((column) => IDENTIFIER_HINTS.test(column.name)) ??
        fallbackPool[0];
      return match?.name ?? null;
    }
    case 'timestamp': {
      const match =
        available.find((column) => column.likelyDate || column.type === 'date') ??
        available.find((column) => TIMESTAMP_HINTS.test(column.name));
      return match?.name ?? null;
    }
    case 'description': {
      const match =
        available.find(
          (column) => column.type === 'string' && DESCRIPTION_HINTS.test(column.name),
        ) ?? available.find((column) => DESCRIPTION_HINTS.test(column.name));
      return match?.name ?? null;
    }
    default:
      return fallbackPool[0]?.name ?? null;
  }
}

export function issueTone(severity: string): BadgeTone {
  return severity === 'error' ? 'danger' : 'warning';
}

export function issuesForRole(issues: ConfigurationIssue[], roleKey: string): ConfigurationIssue[] {
  return issues.filter((issue) => issue.role === roleKey);
}

export const CONFIRMABLE_ISSUE_CODES = new Set([
  'incompatible_identifier',
  'unparseable_timestamp',
  'incompatible_description',
]);

export function roleNeedsConfirmation(issues: ConfigurationIssue[], roleKey: string): boolean {
  return issuesForRole(issues, roleKey).some(
    (issue) => issue.severity === 'error' && CONFIRMABLE_ISSUE_CODES.has(issue.code),
  );
}

export function toConfigurationPayload(
  configuration: WorkflowConfigurationDto,
): Record<string, unknown> {
  return {
    assignments: configuration.assignments,
    mappings: configuration.mappings,
    options: configuration.options,
  };
}
