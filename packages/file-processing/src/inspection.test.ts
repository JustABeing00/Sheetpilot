import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  CorruptFileError,
  EmptyDatasetError,
  InvalidFileError,
  type DatasetAnalysis,
} from '@sheetpilot/core';
import { inspectDataset, type InspectDatasetOptions } from './inspection.js';
import { CsvTabularReader } from './readers/csv-reader.js';
import { XlsxTabularReader } from './readers/xlsx-reader.js';
import type { TabularReader } from './readers/tabular-reader.js';

function csvSource(text: string): () => Promise<Readable> {
  const buffer = Buffer.from(text, 'utf8');
  return () => Promise.resolve(Readable.from([buffer]));
}

function inspectCsv(
  text: string,
  options: Partial<Omit<InspectDatasetOptions, 'reader' | 'openStream'>> = {},
): Promise<DatasetAnalysis> {
  return inspectDataset({
    reader: new CsvTabularReader(),
    openStream: csvSource(text),
    ...options,
  });
}

function inspectXlsx(
  buffer: Buffer,
  reader: TabularReader = new XlsxTabularReader(),
  options: Partial<Omit<InspectDatasetOptions, 'reader' | 'openStream'>> = {},
): Promise<DatasetAnalysis> {
  return inspectDataset({
    reader,
    openStream: () => Promise.resolve(Readable.from([buffer])),
    ...options,
  });
}

async function workbookBuffer(
  sheets: Array<{ name: string; rows: Array<Array<string | number>> }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) {
      worksheet.addRow(row);
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function column(analysis: DatasetAnalysis, name: string) {
  return analysis.columns.find((entry) => entry.name === name)!;
}

describe('inspectDataset', () => {
  it('detects column types, emptiness, dates, identifiers and leading zeros', async () => {
    const csv = [
      'Account Number,Amount,Occurred At,Note,Unused',
      '00123,10.5,2026-03-04T12:30:00Z,first,',
      '00124,20,2026-03-05T08:00:00Z,second,',
    ].join('\n');

    const analysis = await inspectCsv(csv);

    expect(analysis.rowCount).toBe(2);
    expect(analysis.rowCountExact).toBe(true);
    expect(analysis.truncated).toBe(false);
    expect(analysis.columns.map((entry) => entry.name)).toEqual([
      'Account Number',
      'Amount',
      'Occurred At',
      'Note',
      'Unused',
    ]);

    expect(column(analysis, 'Account Number').type).toBe('string');
    expect(column(analysis, 'Account Number').likelyIdentifier).toBe(true);
    expect(column(analysis, 'Amount').type).toBe('number');
    expect(column(analysis, 'Occurred At').type).toBe('date');
    expect(column(analysis, 'Occurred At').likelyDate).toBe(true);
    expect(column(analysis, 'Unused').type).toBe('empty');

    const codes = analysis.warnings.map((entry) => entry.code);
    expect(codes).toContain('leading_zero_identifier');
    expect(codes).toContain('empty_column');

    expect(analysis.sampleRows).toHaveLength(2);
    expect(analysis.sampleRows[0]?.['Account Number']).toBe('00123');
  });

  it('flags duplicate column names and mixed types', async () => {
    const analysis = await inspectCsv('Id,Id,Value\n1,2,abc\n3,4,5\n');

    expect(analysis.columns.map((entry) => entry.name)).toEqual(['Id', 'Value']);
    expect(column(analysis, 'Id').duplicateName).toBe(true);
    expect(column(analysis, 'Value').type).toBe('mixed');

    const codes = analysis.warnings.map((entry) => entry.code);
    expect(codes).toContain('duplicate_column_names');
    expect(codes).toContain('mixed_types');
  });

  it('truncates the scan at the configured row limit', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => `row${index + 1},${index + 1}`);
    const analysis = await inspectCsv(['name,value', ...rows].join('\n'), { maxScanRows: 3 });

    expect(analysis.rowCount).toBe(3);
    expect(analysis.rowCountExact).toBe(false);
    expect(analysis.truncated).toBe(true);
    expect(analysis.warnings.map((entry) => entry.code)).toContain('truncated_scan');
  });

  it('rejects a file with no header row', async () => {
    await expect(inspectCsv('\n')).rejects.toBeInstanceOf(InvalidFileError);
  });

  it('rejects a header-only file as an empty dataset', async () => {
    await expect(inspectCsv('A,B\n')).rejects.toBeInstanceOf(EmptyDatasetError);
  });

  it('lists sheets and inspects the requested sheet', async () => {
    const buffer = await workbookBuffer([
      {
        name: 'Customers',
        rows: [
          ['Name', 'Age'],
          ['Ada', 36],
        ],
      },
      {
        name: 'Orders',
        rows: [
          ['Order', 'Amount'],
          ['O-1', 5],
        ],
      },
    ]);

    const analysis = await inspectXlsx(buffer, new XlsxTabularReader(), { sheetName: 'Orders' });
    expect(analysis.sheetNames).toEqual(['Customers', 'Orders']);
    expect(analysis.sheetName).toBe('Orders');
    expect(analysis.columns.map((entry) => entry.name)).toEqual(['Order', 'Amount']);
    expect(analysis.rowCount).toBe(1);
  });

  it('defaults to the first sheet', async () => {
    const buffer = await workbookBuffer([
      {
        name: 'First',
        rows: [
          ['A', 'B'],
          ['1', '2'],
        ],
      },
      {
        name: 'Second',
        rows: [['C'], ['3']],
      },
    ]);

    const analysis = await inspectXlsx(buffer);
    expect(analysis.sheetName).toBe('First');
    expect(analysis.columns.map((entry) => entry.name)).toEqual(['A', 'B']);
  });

  it('rejects an unknown sheet with a clear error', async () => {
    const buffer = await workbookBuffer([{ name: 'Only', rows: [['A'], ['1']] }]);
    await expect(
      inspectXlsx(buffer, new XlsxTabularReader(), { sheetName: 'Missing' }),
    ).rejects.toBeInstanceOf(InvalidFileError);
  });

  it('reports a corrupt spreadsheet as corrupt', async () => {
    await expect(inspectXlsx(Buffer.from('not really a workbook'))).rejects.toBeInstanceOf(
      CorruptFileError,
    );
  });
});
