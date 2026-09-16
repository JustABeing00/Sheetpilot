import { ExportValidationError, type FileStorage, type TabularFormat } from '@sheetpilot/core';
import { createTabularReader } from '../registry.js';

export interface TableValidationOptions {
  format: TabularFormat;
  /** Column names the generated file must expose, in order. */
  expectedColumns: string[];
  /** Physical data rows the generated file must contain (excludes the header). */
  expectedRowCount: number;
  sheetName?: string;
  signal?: AbortSignal;
}

export interface TableValidationResult {
  columns: string[];
  rowCount: number;
}

function columnsMatch(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  return actual.every((column, index) => column.trim() === expected[index]?.trim());
}

/**
 * Re-reads a just-written artifact and proves it is structurally sound before the run is marked
 * successful: the expected columns are present in order and the row count matches what was written.
 * Rows are streamed (never collected), so validation does not add another full copy of the output
 * to memory. Throws {@link ExportValidationError} on any mismatch.
 */
export async function validateStoredTable(
  storage: FileStorage,
  storageKey: string,
  options: TableValidationOptions,
): Promise<TableValidationResult> {
  const reader = createTabularReader(options.format);
  const readOptions = {
    ...(options.sheetName ? { sheetName: options.sheetName } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  let rowCount = 0;
  let actualColumns: string[] | null = null;

  const stream = await storage.getStream(storageKey);
  for await (const row of reader.read(stream, readOptions)) {
    if (actualColumns === null) {
      actualColumns = Object.keys(row);
    }
    rowCount += 1;
  }

  if (rowCount !== options.expectedRowCount) {
    throw new ExportValidationError(
      `Exported file '${storageKey}' contains ${rowCount} rows but ${options.expectedRowCount} were written`,
      { storageKey, rowCount, expectedRowCount: options.expectedRowCount },
    );
  }

  if (actualColumns !== null && !columnsMatch(actualColumns, options.expectedColumns)) {
    throw new ExportValidationError(
      `Exported file '${storageKey}' columns do not match the generated schema`,
      { storageKey, columns: actualColumns, expectedColumns: options.expectedColumns },
    );
  }

  return { columns: actualColumns ?? options.expectedColumns, rowCount };
}
