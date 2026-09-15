import { parseTimestamp } from './normalize.js';
import {
  cellToString,
  columnNamesFromRows,
  isCellEmpty,
  type CellValue,
  type InferredColumn,
  type InferredColumnType,
  type InferredTableSchema,
  type Row,
} from './table.js';

const BOOLEAN_TEXT = new Set(['true', 'false', 'yes', 'no', 'y', 'n']);

export function inferCellType(value: CellValue | undefined): InferredColumnType {
  if (value === null || value === undefined) {
    return 'empty';
  }
  if (value instanceof Date) {
    return 'date';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  const text = value.trim();
  if (text.length === 0) {
    return 'empty';
  }
  if (BOOLEAN_TEXT.has(text.toLowerCase())) {
    return 'boolean';
  }
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) {
    return /^[+-]?0\d/.test(text) ? 'string' : 'number';
  }
  if (parseTimestamp(text) !== null) {
    return 'date';
  }
  return 'string';
}

function mergeTypes(current: InferredColumnType, next: InferredColumnType): InferredColumnType {
  if (current === 'empty') {
    return next;
  }
  if (next === 'empty' || next === current) {
    return current;
  }
  if (
    (current === 'boolean' && next === 'number') ||
    (current === 'number' && next === 'boolean')
  ) {
    return 'boolean';
  }
  return 'string';
}

export interface InferOptions {
  sampleSize?: number;
  sampleValues?: number;
}

export function inferTableSchema(rows: Row[], options: InferOptions = {}): InferredTableSchema {
  const sampleSize = options.sampleSize ?? rows.length;
  const sampleValueCount = options.sampleValues ?? 5;
  const sample = rows.slice(0, sampleSize);
  const columns: InferredColumn[] = [];

  for (const name of columnNamesFromRows(rows)) {
    let type: InferredColumnType = 'empty';
    let emptyCount = 0;
    const unique = new Set<string>();
    const sampleValues: string[] = [];

    for (const row of sample) {
      const value = row[name];
      if (isCellEmpty(value)) {
        emptyCount += 1;
        continue;
      }
      type = mergeTypes(type, inferCellType(value));
      const text = cellToString(value);
      unique.add(text);
      if (sampleValues.length < sampleValueCount && !sampleValues.includes(text)) {
        sampleValues.push(text);
      }
    }

    columns.push({
      name,
      type: type === 'empty' ? 'empty' : type,
      nullable: emptyCount > 0,
      emptyCount,
      uniqueCount: unique.size,
      sampleValues,
    });
  }

  return { rowCount: rows.length, columns };
}
