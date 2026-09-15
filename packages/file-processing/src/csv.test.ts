import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CsvTabularReader } from './readers/csv-reader.js';
import { CsvTabularWriter } from './writers/csv-writer.js';
import { writeTableToBuffer } from './writers/collect.js';
import { readAllRows } from './readers/tabular-reader.js';
import type { Row } from './table.js';

function stream(text: string): Readable {
  return Readable.from([text]);
}

describe('CsvTabularReader', () => {
  it('reads rows with headers into records', async () => {
    const csv = 'Account Number,Fault Description\n00123,No power\n00456,Battery low\n';
    const table = await readAllRows(new CsvTabularReader(), stream(csv));

    expect(table.rowCount).toBe(2);
    expect(table.columns).toEqual(['Account Number', 'Fault Description']);
    expect(table.rows[0]).toEqual({ 'Account Number': '00123', 'Fault Description': 'No power' });
  });

  it('honours quoted delimiters, embedded newlines and BOM', async () => {
    const csv = '\uFEFFid,note\n1,"hello, world"\n2,"line1\nline2"\n';
    const table = await readAllRows(new CsvTabularReader(), stream(csv));

    expect(table.rows[0]?.['note']).toBe('hello, world');
    expect(table.rows[1]?.['note']).toBe('line1\nline2');
  });

  it('supports a row limit', async () => {
    const csv = 'id\n1\n2\n3\n4\n';
    const table = await readAllRows(new CsvTabularReader(), stream(csv), { limit: 2 });
    expect(table.rows).toHaveLength(2);
  });

  it('rejects quoted-parse failures without crashing the process', async () => {
    const csv = 'id,note\n1,ok\n';
    const table = await readAllRows(new CsvTabularReader(), stream(csv));
    expect(table.rows).toEqual([{ id: '1', note: 'ok' }]);
  });
});

describe('CsvTabularWriter', () => {
  it('writes a header row and round-trips values', async () => {
    const rows: Row[] = [
      { account: '00123', rootCause: 'Power Loss', count: 2 },
      { account: '00456', rootCause: null, count: 1 },
    ];

    const { buffer, result } = await writeTableToBuffer(new CsvTabularWriter(), rows, {
      columns: ['account', 'rootCause', 'count'],
    });

    expect(result.rowCount).toBe(2);
    const text = buffer.toString('utf8');
    expect(text.split('\n')[0]).toBe('"account","rootCause","count"');

    const parsed = await readAllRows(new CsvTabularReader(), stream(text));
    expect(parsed.rows[0]).toEqual({ account: '00123', rootCause: 'Power Loss', count: '2' });
    expect(parsed.rows[1]?.['rootCause']).toBe('');
  });
});
