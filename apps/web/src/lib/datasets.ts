import type { DatasetColumn, DatasetWarning } from '@sheetpilot/core';
import type { BadgeTone } from './status.js';

export function columnTypeTone(type: string): BadgeTone {
  switch (type) {
    case 'number':
      return 'info';
    case 'date':
      return 'success';
    case 'empty':
      return 'warning';
    case 'mixed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function warningTone(severity: string): BadgeTone {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

export function formatRatio(value: number): string {
  if (Number.isNaN(value) || value < 0) {
    return '—';
  }
  return `${Math.round(value * 100)}%`;
}

export interface ColumnFlag {
  label: string;
  tone: BadgeTone;
}

export function columnFlags(column: DatasetColumn): ColumnFlag[] {
  const flags: ColumnFlag[] = [];
  if (column.duplicateName) {
    flags.push({ label: 'duplicate name', tone: 'warning' });
  }
  if (column.likelyDate) {
    flags.push({ label: 'date-like', tone: 'success' });
  }
  if (column.likelyIdentifier) {
    flags.push({ label: 'identifier', tone: 'info' });
  }
  return flags;
}

export function warningLabel(warning: DatasetWarning): string {
  return warning.column ? `${warning.code} · ${warning.column}` : warning.code;
}
