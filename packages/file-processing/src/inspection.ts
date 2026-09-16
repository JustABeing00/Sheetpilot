import type { Readable } from 'node:stream';
import {
  CorruptFileError,
  EmptyDatasetError,
  InvalidFileError,
  isAppError,
  type DatasetAnalysis,
  type DatasetColumn,
  type DatasetColumnType,
  type DatasetWarning,
  type SampleRow,
  type TabularFormat,
} from '@sheetpilot/core';
import { inferCellType } from './inference.js';
import { parseTimestamp } from './normalize.js';
import type { TabularReader } from './readers/tabular-reader.js';
import { cellToString, isCellEmpty, type InferredColumnType, type CellValue } from './table.js';

export const DEFAULT_SAMPLE_ROWS = 10;
export const DEFAULT_SAMPLE_VALUES = 5;
export const DEFAULT_MAX_SCAN_ROWS = 200_000;
export const DEFAULT_MAX_TRACKED_UNIQUE = 5_000;

const DATE_NAME = /(date|time|timestamp|_at$|created|updated|modified|occurred|reported)/i;
const IDENTIFIER_NAME =
  /(^|[^a-z0-9])(id|ids|no|nos|num|number|account|acct|key|code|ref|reference|serial|sku|uuid|guid|msisdn|imei|vin|plate)([^a-z0-9]|$)/i;
const IDENTIFIER_SUFFIX = /(_id|_no|_num|_number|_key|_code|_ref|_account)$/i;

export interface InspectDatasetOptions {
  reader: TabularReader;
  /** Opens a fresh readable stream each time; inspection never buffers the whole file. */
  openStream: () => Promise<Readable>;
  sheetName?: string;
  sampleRows?: number;
  sampleValues?: number;
  maxScanRows?: number;
  maxTrackedUnique?: number;
  signal?: AbortSignal;
}

interface ColumnAccumulator {
  name: string;
  index: number;
  types: Set<InferredColumnType>;
  emptyCount: number;
  nonEmptyCount: number;
  unique: Set<string>;
  uniqueCapped: boolean;
  sampleValues: string[];
  leadingZeroCount: number;
}

function describeError(format: TabularFormat, error: unknown): CorruptFileError {
  if (isAppError(error)) {
    return new CorruptFileError(error.message, { format }, error);
  }
  const reason = error instanceof Error ? error.message : 'unknown read error';
  return new CorruptFileError(
    `The ${format.toUpperCase()} file could not be parsed: ${reason}`,
    { format },
    error,
  );
}

function resolveSheetName(
  requested: string | undefined,
  sheetNames: string[],
  format: TabularFormat,
): string | null {
  if (format !== 'xlsx') {
    return null;
  }
  if (sheetNames.length === 0) {
    throw new EmptyDatasetError('The workbook does not contain any worksheets.', { format });
  }
  if (requested === undefined || requested.trim().length === 0) {
    return sheetNames[0] ?? null;
  }
  if (!sheetNames.includes(requested)) {
    throw new InvalidFileError(
      `Sheet "${requested}" was not found. Available sheets: ${sheetNames.join(', ')}.`,
      { requested, sheetNames },
    );
  }
  return requested;
}

function resolveColumnType(types: Set<InferredColumnType>): DatasetColumnType {
  const nonEmpty = [...types].filter((type) => type !== 'empty');
  if (nonEmpty.length === 0) {
    return 'empty';
  }
  if (nonEmpty.length === 1) {
    return nonEmpty[0]!;
  }
  if (nonEmpty.every((type) => type === 'boolean' || type === 'number')) {
    return 'boolean';
  }
  return 'mixed';
}

function looksLikeIdentifier(
  accumulator: ColumnAccumulator,
  type: DatasetColumnType,
  uniqueRatio: number,
): boolean {
  if (IDENTIFIER_NAME.test(accumulator.name) || IDENTIFIER_SUFFIX.test(accumulator.name)) {
    return true;
  }
  if (accumulator.nonEmptyCount < 5 || uniqueRatio < 0.95) {
    return false;
  }
  if (type !== 'string' && type !== 'number') {
    return false;
  }
  const samples = accumulator.sampleValues;
  if (samples.length === 0) {
    return false;
  }
  const averageLength = samples.reduce((sum, value) => sum + value.length, 0) / samples.length;
  return averageLength <= 40;
}

function looksLikeDate(
  accumulator: ColumnAccumulator,
  type: DatasetColumnType,
  samplesParsedAsDates: boolean,
): boolean {
  if (type === 'date') {
    return true;
  }
  return DATE_NAME.test(accumulator.name) && samplesParsedAsDates;
}

function finalizeColumn(accumulator: ColumnAccumulator, rowCount: number): DatasetColumn {
  const type = resolveColumnType(accumulator.types);
  const emptyRatio = rowCount === 0 ? 0 : accumulator.emptyCount / rowCount;
  const uniqueRatio =
    accumulator.nonEmptyCount === 0
      ? 0
      : Math.min(1, accumulator.unique.size / accumulator.nonEmptyCount);
  const samplesParsedAsDates = accumulator.sampleValues.some(
    (value) => parseTimestamp(value) !== null,
  );

  return {
    name: accumulator.name,
    index: accumulator.index,
    type,
    nonEmptyCount: accumulator.nonEmptyCount,
    emptyCount: accumulator.emptyCount,
    emptyRatio: Number(emptyRatio.toFixed(4)),
    uniqueCount: accumulator.unique.size,
    uniqueRatio: Number(uniqueRatio.toFixed(4)),
    sampleValues: accumulator.sampleValues,
    duplicateName: false,
    likelyDate: looksLikeDate(accumulator, type, samplesParsedAsDates),
    likelyIdentifier: looksLikeIdentifier(accumulator, type, uniqueRatio),
  };
}

function buildWarnings(
  columns: DatasetColumn[],
  duplicateNames: string[],
  truncated: boolean,
  leadingZeroNames: Set<string>,
): DatasetWarning[] {
  const warnings: DatasetWarning[] = [];

  if (duplicateNames.length > 0) {
    warnings.push({
      code: 'duplicate_column_names',
      severity: 'warning',
      message: `Duplicate column names detected: ${duplicateNames.join(', ')}. Only the last occurrence is used per row.`,
      column: null,
    });
  }

  for (const column of columns) {
    if (column.nonEmptyCount === 0) {
      warnings.push({
        code: 'empty_column',
        severity: 'warning',
        message: `Column "${column.name}" is empty in every scanned row.`,
        column: column.name,
      });
      continue;
    }
    if (column.emptyRatio >= 0.5) {
      warnings.push({
        code: 'mostly_empty_column',
        severity: 'info',
        message: `Column "${column.name}" is empty in ${Math.round(column.emptyRatio * 100)}% of the scanned rows.`,
        column: column.name,
      });
    }
    if (column.type === 'mixed') {
      warnings.push({
        code: 'mixed_types',
        severity: 'warning',
        message: `Column "${column.name}" contains values of more than one type.`,
        column: column.name,
      });
    }
    if (column.type === 'string' && leadingZeroNames.has(column.name)) {
      warnings.push({
        code: 'leading_zero_identifier',
        severity: 'info',
        message: `Column "${column.name}" keeps leading zeros; it will be treated as text, not a number.`,
        column: column.name,
      });
    }
  }

  if (truncated) {
    warnings.push({
      code: 'truncated_scan',
      severity: 'warning',
      message:
        'The row scan stopped at the configured limit; counts and samples cover only the scanned rows.',
      column: null,
    });
  }

  return warnings;
}

/**
 * Streams a dataset once to build its normalized profile (columns, inferred types, samples and
 * warnings) without loading the full table into memory. Row counting and statistics are bounded by
 * `maxScanRows`; uniqueness tracking is additionally bounded by `maxTrackedUnique`.
 */
export async function inspectDataset(options: InspectDatasetOptions): Promise<DatasetAnalysis> {
  const maxScanRows = options.maxScanRows ?? DEFAULT_MAX_SCAN_ROWS;
  const sampleRowsLimit = options.sampleRows ?? DEFAULT_SAMPLE_ROWS;
  const sampleValuesLimit = options.sampleValues ?? DEFAULT_SAMPLE_VALUES;
  const maxTrackedUnique = options.maxTrackedUnique ?? DEFAULT_MAX_TRACKED_UNIQUE;

  let description;
  try {
    description = await options.reader.describe(await options.openStream(), {
      sheetName: options.sheetName,
    });
  } catch (error) {
    throw describeError(options.reader.format, error);
  }

  const sheetName = resolveSheetName(
    options.sheetName,
    description.sheetNames,
    options.reader.format,
  );

  const columnNames: string[] = [];
  const seen = new Set<string>();
  const duplicateNames: string[] = [];
  for (const raw of description.headers) {
    const name = raw.trim();
    if (name.length === 0) {
      continue;
    }
    if (seen.has(name)) {
      if (!duplicateNames.includes(name)) {
        duplicateNames.push(name);
      }
      continue;
    }
    seen.add(name);
    columnNames.push(name);
  }

  if (columnNames.length === 0) {
    throw new InvalidFileError('The file does not contain a header row with column names.', {
      sheetName,
      format: options.reader.format,
    });
  }

  const accumulators = columnNames.map<ColumnAccumulator>((name, index) => ({
    name,
    index,
    types: new Set<InferredColumnType>(),
    emptyCount: 0,
    nonEmptyCount: 0,
    unique: new Set<string>(),
    uniqueCapped: false,
    sampleValues: [],
    leadingZeroCount: 0,
  }));

  const sampleRows: SampleRow[] = [];
  let rowCount = 0;
  let truncated = false;

  try {
    const stream = await options.openStream();
    for await (const row of options.reader.read(stream, {
      sheetName: sheetName ?? undefined,
      limit: maxScanRows + 1,
      signal: options.signal,
    })) {
      rowCount += 1;
      if (rowCount > maxScanRows) {
        truncated = true;
        rowCount = maxScanRows;
        break;
      }

      if (sampleRows.length < sampleRowsLimit) {
        const sample: SampleRow = {};
        for (const name of columnNames) {
          sample[name] = cellToString(row[name]);
        }
        sampleRows.push(sample);
      }

      for (const accumulator of accumulators) {
        const value: CellValue | undefined = row[accumulator.name];
        if (isCellEmpty(value)) {
          accumulator.emptyCount += 1;
          continue;
        }
        accumulator.nonEmptyCount += 1;
        accumulator.types.add(inferCellType(value));
        const text = cellToString(value);
        if (!accumulator.uniqueCapped) {
          if (accumulator.unique.size < maxTrackedUnique) {
            accumulator.unique.add(text);
          } else {
            accumulator.uniqueCapped = true;
          }
        }
        if (
          accumulator.sampleValues.length < sampleValuesLimit &&
          !accumulator.sampleValues.includes(text)
        ) {
          accumulator.sampleValues.push(text);
        }
        if (/^[+-]?0\d/.test(text)) {
          accumulator.leadingZeroCount += 1;
        }
      }
    }
  } catch (error) {
    throw describeError(options.reader.format, error);
  }

  if (rowCount === 0) {
    throw new EmptyDatasetError('The file contains a header row but no data rows.', {
      sheetName,
      columns: columnNames,
    });
  }

  const columns = accumulators.map((accumulator) => {
    const column = finalizeColumn(accumulator, rowCount);
    return { ...column, duplicateName: duplicateNames.includes(column.name) };
  });

  const leadingZeroNames = new Set(
    accumulators
      .filter((accumulator) => accumulator.leadingZeroCount > 0)
      .map((accumulator) => accumulator.name),
  );
  const warnings = buildWarnings(columns, duplicateNames, truncated, leadingZeroNames);

  return {
    sheetNames: description.sheetNames,
    sheetName,
    rowCount,
    rowCountExact: !truncated,
    truncated,
    scanLimit: maxScanRows,
    columns,
    sampleRows,
    warnings,
  };
}
