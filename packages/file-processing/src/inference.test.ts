import { describe, expect, it } from 'vitest';
import { inferCellType, inferTableSchema } from './inference.js';
import { detectTabularFormat, createTabularReader, createTabularWriter } from './registry.js';
import type { Row } from './table.js';

describe('inferCellType', () => {
  it('classifies primitives and text', () => {
    expect(inferCellType(42)).toBe('number');
    expect(inferCellType('42.5')).toBe('number');
    expect(inferCellType('00123')).toBe('string');
    expect(inferCellType(true)).toBe('boolean');
    expect(inferCellType('YES')).toBe('boolean');
    expect(inferCellType(new Date('2026-01-01T00:00:00Z'))).toBe('date');
    expect(inferCellType('2026-01-01')).toBe('date');
    expect(inferCellType('no power detected')).toBe('string');
    expect(inferCellType('')).toBe('empty');
    expect(inferCellType(null)).toBe('empty');
  });
});

describe('inferTableSchema', () => {
  it('infers column types, nullability and uniqueness', () => {
    const rows: Row[] = [
      { account: '001', count: '3', when: '2026-01-01', note: 'a' },
      { account: '002', count: '4', when: '2026-01-02', note: 'b' },
      { account: '002', count: null, when: '2026-01-03', note: 'a' },
    ];

    const schema = inferTableSchema(rows);
    const account = schema.columns.find((column) => column.name === 'account');
    const count = schema.columns.find((column) => column.name === 'count');
    const when = schema.columns.find((column) => column.name === 'when');

    expect(schema.rowCount).toBe(3);
    expect(account).toMatchObject({ type: 'string', nullable: false, uniqueCount: 2 });
    expect(count).toMatchObject({ type: 'number', nullable: true, emptyCount: 1 });
    expect(when?.type).toBe('date');
  });

  it('falls back to string when a column mixes types', () => {
    const rows: Row[] = [{ value: '1' }, { value: 'abc' }];
    expect(inferTableSchema(rows).columns[0]?.type).toBe('string');
  });
});

describe('detectTabularFormat', () => {
  it('detects by extension', () => {
    expect(detectTabularFormat('faults.CSV')).toBe('csv');
    expect(detectTabularFormat('faults.xlsx')).toBe('xlsx');
    expect(detectTabularFormat('faults.xlsm')).toBe('xlsx');
    expect(detectTabularFormat('faults.tsv')).toBe('csv');
  });

  it('sniffs content when the extension is unknown', () => {
    expect(detectTabularFormat('upload', Buffer.from('PK\u0003\u0004'))).toBe('xlsx');
    expect(detectTabularFormat('upload', 'a,b\n1,2\n')).toBe('csv');
    expect(detectTabularFormat('upload', 'no delimiters here')).toBeNull();
  });

  it('creates readers and writers for each format', () => {
    expect(createTabularReader('csv').format).toBe('csv');
    expect(createTabularReader('xlsx').format).toBe('xlsx');
    expect(createTabularWriter('csv').format).toBe('csv');
    expect(createTabularWriter('xlsx').format).toBe('xlsx');
  });
});
