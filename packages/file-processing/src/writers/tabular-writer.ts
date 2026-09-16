import type { Writable } from 'node:stream';
import type { Row } from '../table.js';

export interface SummaryRow {
  label: string;
  value: string | number;
}

/**
 * Optional human-readable summary written as a leading worksheet. Supported by the XLSX writer
 * (CSV has no concept of multiple tables and ignores it). Used to put the run summary in front of
 * the exported data without changing the row data sheet.
 */
export interface WriteSummary {
  rows: SummaryRow[];
}

export interface WriteOptions {
  columns: string[];
  sheetName?: string;
  signal?: AbortSignal;
  summary?: WriteSummary;
}

export interface WriteResult {
  rowCount: number;
  columns: string[];
}

export interface TabularWriter {
  readonly format: 'csv' | 'xlsx';
  write(
    rows: Iterable<Row> | AsyncIterable<Row>,
    sink: Writable,
    options: WriteOptions,
  ): Promise<WriteResult>;
}
