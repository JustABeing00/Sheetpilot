import type { Writable } from 'node:stream';
import type { Row } from '../table.js';

export interface WriteOptions {
  columns: string[];
  sheetName?: string;
  signal?: AbortSignal;
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
