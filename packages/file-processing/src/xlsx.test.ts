import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { XlsxTabularWriter } from './writers/xlsx-writer.js';
import { XlsxTabularReader } from './readers/xlsx-reader.js';
import { writeTableToBuffer } from './writers/collect.js';
import { readAllRows } from './readers/tabular-reader.js';
import type { Row } from './table.js';

describe('xlsx round trip', () => {
  it('preserves strings, numbers, booleans, dates and nulls', async () => {
    const rows: Row[] = [
      {
        account: '00123',
        count: 3,
        active: true,
        occurredAt: new Date('2026-03-04T12:30:00.000Z'),
        note: null,
      },
    ];

    const { buffer, result } = await writeTableToBuffer(new XlsxTabularWriter(), rows, {
      columns: ['account', 'count', 'active', 'occurredAt', 'note'],
      sheetName: 'Faults',
    });

    expect(result.rowCount).toBe(1);
    expect(buffer.length).toBeGreaterThan(0);

    const table = await readAllRows(new XlsxTabularReader(), Readable.from([buffer]));
    expect(table.columns).toEqual(['account', 'count', 'active', 'occurredAt', 'note']);

    const row = table.rows[0]!;
    expect(row['account']).toBe('00123');
    expect(row['count']).toBe(3);
    expect(row['active']).toBe(true);
    expect(row['note']).toBeNull();
    expect((row['occurredAt'] as Date).toISOString()).toBe('2026-03-04T12:30:00.000Z');
  });

  it('does not execute spreadsheet formulas from cell content', async () => {
    const rows: Row[] = [{ account: 'a', note: '=SUM(A1:A2)' }];
    const { buffer } = await writeTableToBuffer(new XlsxTabularWriter(), rows, {
      columns: ['account', 'note'],
    });

    const table = await readAllRows(new XlsxTabularReader(), Readable.from([buffer]));
    expect(table.rows[0]?.['note']).toBe('=SUM(A1:A2)');
  });

  it('returns no rows for an empty sheet body', async () => {
    const { buffer } = await writeTableToBuffer(new XlsxTabularWriter(), [], {
      columns: ['account'],
    });
    const table = await readAllRows(new XlsxTabularReader(), Readable.from([buffer]));
    expect(table.rowCount).toBe(0);
  });
});
