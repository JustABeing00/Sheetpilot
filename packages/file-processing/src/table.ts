export type CellValue = string | number | boolean | Date | null;

export type Row = Record<string, CellValue>;

export interface TableData {
  columns: string[];
  rows: Row[];
  rowCount: number;
}

export type InferredColumnType = 'empty' | 'number' | 'boolean' | 'date' | 'string';

export interface InferredColumn {
  name: string;
  type: InferredColumnType;
  nullable: boolean;
  emptyCount: number;
  uniqueCount: number;
  sampleValues: string[];
}

export interface InferredTableSchema {
  rowCount: number;
  columns: InferredColumn[];
}

export function columnNamesFromRows(rows: Iterable<Row>): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  return ordered;
}

export function isCellEmpty(value: CellValue | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  return false;
}

export function cellToString(value: CellValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}
