import type { TabularFormat } from '@sheetpilot/core';
import { CsvTabularReader } from './readers/csv-reader.js';
import type { TabularReader } from './readers/tabular-reader.js';
import { XlsxTabularReader } from './readers/xlsx-reader.js';
import { CsvTabularWriter } from './writers/csv-writer.js';
import type { TabularWriter } from './writers/tabular-writer.js';
import { XlsxTabularWriter } from './writers/xlsx-writer.js';

export const SUPPORTED_TABULAR_FORMATS: readonly TabularFormat[] = ['csv', 'xlsx'];

const XLSX_EXTENSIONS = ['.xlsx', '.xlsm'];
const CSV_EXTENSIONS = ['.csv', '.txt', '.tsv'];

export function detectTabularFormat(
  fileName: string,
  head?: Buffer | Uint8Array | string,
): TabularFormat | null {
  const lower = fileName.toLowerCase();

  if (XLSX_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return 'xlsx';
  }
  if (CSV_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return 'csv';
  }

  if (head !== undefined) {
    const bytes = typeof head === 'string' ? Buffer.from(head) : Buffer.from(head);
    if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
      return 'xlsx';
    }
    if (/[,\t;]/.test(bytes.toString('utf8', 0, Math.min(bytes.length, 4096)))) {
      return 'csv';
    }
  }

  return null;
}

export function createTabularReader(format: TabularFormat): TabularReader {
  switch (format) {
    case 'csv':
      return new CsvTabularReader();
    case 'xlsx':
      return new XlsxTabularReader();
  }
}

export function createTabularWriter(format: TabularFormat): TabularWriter {
  switch (format) {
    case 'csv':
      return new CsvTabularWriter();
    case 'xlsx':
      return new XlsxTabularWriter();
  }
}
