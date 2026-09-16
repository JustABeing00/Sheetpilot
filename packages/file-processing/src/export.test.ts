import { describe, expect, it } from 'vitest';
import { ExportValidationError } from '@sheetpilot/core';
import { XlsxTabularWriter } from './writers/xlsx-writer.js';
import { CsvTabularWriter } from './writers/csv-writer.js';
import { writeTableToStorage } from './writers/stream.js';
import { validateStoredTable } from './export/validate.js';
import { InMemoryFileStorage } from './storage/memory-file-storage.js';
import { createTabularReader } from './registry.js';
import { readAllRows } from './readers/tabular-reader.js';
import type { Row } from './table.js';

function makeRows(): Row[] {
  return [
    {
      account: '00123',
      site: 'North Ridge',
      rootCause: 'Power Loss',
      count: 2,
      occurredAt: new Date('2026-03-04T10:30:00.000Z'),
      note: null,
    },
    {
      account: '9007199254740993',
      site: 'Harbor Point',
      rootCause: 'Unspecified',
      count: null,
      occurredAt: null,
      note: null,
    },
  ];
}

const columns = ['account', 'site', 'rootCause', 'count', 'occurredAt', 'note'];

describe('export writing and validation', () => {
  it('streams a CSV into storage and validates it', async () => {
    const storage = new InMemoryFileStorage();
    const rows = makeRows();

    const { stored, result } = await writeTableToStorage(
      new CsvTabularWriter(),
      rows,
      { columns },
      storage,
      'runs/run-1/out.csv',
    );

    expect(result.rowCount).toBe(2);
    expect(stored.sizeBytes).toBeGreaterThan(0);
    expect(await storage.exists('runs/run-1/out.csv')).toBe(true);

    const validation = await validateStoredTable(storage, 'runs/run-1/out.csv', {
      format: 'csv',
      expectedColumns: columns,
      expectedRowCount: 2,
    });
    expect(validation.rowCount).toBe(2);
    expect(validation.columns).toEqual(columns);

    const table = await readAllRows(
      createTabularReader('csv'),
      await storage.getStream('runs/run-1/out.csv'),
    );
    // CSV is textual, so a leading-zero identifier stays a string with its zeros intact.
    expect(table.rows[0]?.['account']).toBe('00123');
    expect(table.rows[1]?.['account']).toBe('9007199254740993');
  });

  it('writes a leading Summary worksheet and preserves cell types in XLSX', async () => {
    const storage = new InMemoryFileStorage();
    const rows = makeRows();
    const summary = {
      rows: [
        { label: 'Total records', value: 2 },
        { label: 'Automatically resolved', value: 1 },
        { label: 'Needs review', value: 1 },
      ],
    };

    await writeTableToStorage(
      new XlsxTabularWriter(),
      rows,
      { columns, sheetName: 'Output', summary },
      storage,
      'runs/run-1/out.xlsx',
    );

    const described = await createTabularReader('xlsx').describe(
      await storage.getStream('runs/run-1/out.xlsx'),
    );
    expect(described.sheetNames).toEqual(['Summary', 'Output']);

    const validation = await validateStoredTable(storage, 'runs/run-1/out.xlsx', {
      format: 'xlsx',
      expectedColumns: columns,
      expectedRowCount: 2,
      sheetName: 'Output',
    });
    expect(validation.rowCount).toBe(2);

    const table = await readAllRows(
      createTabularReader('xlsx'),
      await storage.getStream('runs/run-1/out.xlsx'),
      { sheetName: 'Output' },
    );
    const [first, second] = table.rows;
    expect(first?.['account']).toBe('00123');
    expect(typeof first?.['account']).toBe('string');
    expect(first?.['count']).toBe(2);
    expect(second?.['count']).toBeNull();
    expect(second?.['note']).toBeNull();
    expect((first?.['occurredAt'] as Date).toISOString()).toBe('2026-03-04T10:30:00.000Z');
    // A numeric-looking identifier longer than Number.MAX_SAFE_INTEGER must stay a string.
    expect(second?.['account']).toBe('9007199254740993');

    const summaryTable = await readAllRows(
      createTabularReader('xlsx'),
      await storage.getStream('runs/run-1/out.xlsx'),
      { sheetName: 'Summary' },
    );
    expect(summaryTable.rows.map((row) => row['Metric'])).toEqual([
      'Total records',
      'Automatically resolved',
      'Needs review',
    ]);
    expect(summaryTable.rows[0]?.['Value']).toBe(2);
  });

  it('fails validation when the written row count differs from the expectation', async () => {
    const storage = new InMemoryFileStorage();
    await writeTableToStorage(
      new CsvTabularWriter(),
      makeRows(),
      { columns },
      storage,
      'runs/run-2/out.csv',
    );

    await expect(
      validateStoredTable(storage, 'runs/run-2/out.csv', {
        format: 'csv',
        expectedColumns: columns,
        expectedRowCount: 3,
      }),
    ).rejects.toBeInstanceOf(ExportValidationError);
  });

  it('fails validation when the written columns differ from the expectation', async () => {
    const storage = new InMemoryFileStorage();
    await writeTableToStorage(
      new CsvTabularWriter(),
      makeRows(),
      { columns },
      storage,
      'runs/run-3/out.csv',
    );

    await expect(
      validateStoredTable(storage, 'runs/run-3/out.csv', {
        format: 'csv',
        expectedColumns: ['account', 'site', 'wrong'],
        expectedRowCount: 2,
      }),
    ).rejects.toBeInstanceOf(ExportValidationError);
  });
});
