import type { Readable } from 'node:stream';
import type { Row, TableData } from '../table.js';
import { columnNamesFromRows } from '../table.js';

export interface ReadOptions {
  sheetName?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface DescribeOptions {
  sheetName?: string;
}

/**
 * Format-level metadata read from a source without materialising its rows.
 * `headers` preserves source order, duplicates and blank header cells.
 */
export interface SourceDescription {
  sheetNames: string[];
  headers: string[];
}

export interface TabularReader {
  readonly format: 'csv' | 'xlsx';
  read(source: Readable, options?: ReadOptions): AsyncGenerator<Row>;
  describe(source: Readable, options?: DescribeOptions): Promise<SourceDescription>;
}

export async function readAllRows(
  reader: TabularReader,
  source: Readable,
  options: ReadOptions = {},
): Promise<TableData> {
  const rows: Row[] = [];
  for await (const row of reader.read(source, options)) {
    rows.push(row);
    if (options.limit !== undefined && rows.length >= options.limit) {
      break;
    }
  }
  return { columns: columnNamesFromRows(rows), rows, rowCount: rows.length };
}

export async function countRows(
  reader: TabularReader,
  source: Readable,
  options: ReadOptions = {},
): Promise<number> {
  const iterator = reader.read(source, options);
  let rows = 0;
  for (;;) {
    const next = await iterator.next();
    if (next.done === true) {
      return rows;
    }
    rows += 1;
  }
}
