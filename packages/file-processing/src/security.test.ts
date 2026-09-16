import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CorruptFileError, StorageError } from '@sheetpilot/core';
import { sanitizeFileName } from './upload.js';
import { assertWorkbookArchiveSafe, readZipArchiveSummary } from './archive.js';
import { LocalFileStorage } from './storage/local-file-storage.js';
import { InMemoryFileStorage } from './storage/memory-file-storage.js';
import { writeTableToBuffer } from './writers/collect.js';
import { XlsxTabularWriter } from './writers/xlsx-writer.js';

describe('sanitizeFileName hardening', () => {
  it('neutralises Windows reserved device names', () => {
    expect(sanitizeFileName('CON.csv')).toBe('_CON.csv');
    expect(sanitizeFileName('nul')).toBe('_nul');
    expect(sanitizeFileName('COM1.xlsx')).toBe('_COM1.xlsx');
  });

  it('removes Windows-illegal characters and surrounding dots/spaces', () => {
    expect(sanitizeFileName('inv<>:"|?*.csv')).toBe('inv.csv');
    expect(sanitizeFileName('...hidden.csv')).toBe('hidden.csv');
    expect(sanitizeFileName('trailing.csv.  ')).toBe('trailing.csv');
  });

  it('bounds very long names while keeping the extension', () => {
    const name = `${'a'.repeat(400)}.csv`;
    const safe = sanitizeFileName(name);
    expect(safe.length).toBeLessThanOrEqual(120);
    expect(safe.endsWith('.csv')).toBe(true);
  });

  it('still strips path components and control characters', () => {
    expect(sanitizeFileName('../../etc/passwd.csv')).toBe('passwd.csv');
    expect(sanitizeFileName('..\\..\\evil.xlsx')).toBe('evil.xlsx');
    expect(sanitizeFileName('bad\u0000name.csv')).toBe('badname.csv');
    expect(sanitizeFileName('/')).toBe('upload');
  });
});

describe('LocalFileStorage path containment', () => {
  const roots: string[] = [];

  async function makeStorage(): Promise<{ storage: LocalFileStorage; root: string }> {
    const root = await mkdtemp(path.join(tmpdir(), 'sheetpilot-storage-'));
    roots.push(root);
    return { storage: new LocalFileStorage(root), root };
  }

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it.each([
    '../escape.csv',
    '..\\escape.csv',
    'a/../../escape.csv',
    '/etc/passwd',
    'C:/windows/system32',
    'C:relative',
    './file.csv',
    'a//b.csv',
    'bad\u0000key',
    '',
  ])('rejects traversal-shaped key %j', async (key) => {
    const { storage } = await makeStorage();
    await expect(storage.put(key, Buffer.from('x'))).rejects.toBeInstanceOf(StorageError);
  });

  it('round-trips a safe key and can list it by prefix', async () => {
    const { storage } = await makeStorage();
    await storage.put('uploads/csv/a.csv', Buffer.from('a,b\n1,2\n'));
    await storage.put('runs/run-1/out.csv', Buffer.from('x'));

    expect(await storage.exists('uploads/csv/a.csv')).toBe(true);
    const uploads = await storage.list('uploads/');
    expect(uploads.map((item) => item.key)).toEqual(['uploads/csv/a.csv']);
    expect(uploads[0]?.sizeBytes).toBe(8);
    expect(uploads[0]?.modifiedAt).toBeInstanceOf(Date);

    const all = await storage.list();
    expect(all).toHaveLength(2);
  });
});

/** Builds a ZIP central directory + EOCD that the (non-inflating) archive reader can inspect. */
function buildZipDirectory(
  entries: Array<{ name: string; compressed: number; uncompressed: number }>,
): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt32LE(entry.compressed, 20);
    header.writeUInt32LE(entry.uncompressed, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    parts.push(header, name);
  }
  const directory = Buffer.concat(parts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([directory, eocd]);
}

describe('workbook archive guard', () => {
  const limits = { maxEntries: 100, maxUncompressedBytes: 10 * 1024 * 1024 };

  it('summarises a normal directory', () => {
    const archive = buildZipDirectory([
      { name: 'xl/workbook.xml', compressed: 100, uncompressed: 400 },
      { name: 'xl/worksheets/sheet1.xml', compressed: 200, uncompressed: 900 },
    ]);
    const summary = readZipArchiveSummary(archive);
    expect(summary).toMatchObject({ entryCount: 2, uncompressedBytes: 1300, zip64: false });
  });

  it('rejects a decompression bomb (tiny archive, enormous expansion)', () => {
    const archive = buildZipDirectory([
      { name: 'xl/worksheets/sheet1.xml', compressed: 50, uncompressed: 500 * 1024 * 1024 },
    ]);
    expect(() => assertWorkbookArchiveSafe(archive, 'bomb.xlsx', limits)).toThrow(CorruptFileError);
  });

  it('rejects an archive with too many entries', () => {
    const archive = buildZipDirectory(
      Array.from({ length: 101 }, (_value, index) => ({
        name: `entry-${index}`,
        compressed: 1,
        uncompressed: 1,
      })),
    );
    expect(() => assertWorkbookArchiveSafe(archive, 'many.xlsx', limits)).toThrow(CorruptFileError);
  });

  it('accepts a small archive and tolerates unreadable ones', () => {
    const archive = buildZipDirectory([{ name: 'a', compressed: 1, uncompressed: 2 }]);
    expect(() => assertWorkbookArchiveSafe(archive, 'ok.xlsx', limits)).not.toThrow();
    expect(() => assertWorkbookArchiveSafe(Buffer.from('not a zip'), 'x.xlsx', limits)).not.toThrow();
  });

  it('does not reject a genuine workbook written by the reader', async () => {
    const { buffer } = await writeTableToBuffer(
      new XlsxTabularWriter(),
      [{ account: '00123', note: 'ok' }],
      { columns: ['account', 'note'], sheetName: 'Faults' },
    );
    expect(readZipArchiveSummary(buffer)?.entryCount).toBeGreaterThan(0);
    expect(() => assertWorkbookArchiveSafe(buffer, 'real.xlsx', limits)).not.toThrow();
  });
});

describe('InMemoryFileStorage list', () => {
  it('lists by prefix with metadata', async () => {
    const storage = new InMemoryFileStorage();
    await storage.put('uploads/csv/a.csv', Buffer.from('abc'));
    await storage.put('runs/1/out.csv', Buffer.from('de'));

    expect((await storage.list('uploads/')).map((item) => item.key)).toEqual([
      'uploads/csv/a.csv',
    ]);
    expect(await storage.list()).toHaveLength(2);
  });
});
