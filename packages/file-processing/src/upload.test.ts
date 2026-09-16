import { describe, expect, it } from 'vitest';
import {
  CorruptFileError,
  InvalidFileError,
  OversizedFileError,
  UnsupportedFormatError,
} from '@sheetpilot/core';
import { sanitizeFileName, validateUpload } from './upload.js';

const LIMITS = { maxBytes: 1024 };

describe('sanitizeFileName', () => {
  it('reduces a path-traversal name to its basename', () => {
    expect(sanitizeFileName('..\\..\\etc\\evil.csv')).toBe('evil.csv');
    expect(sanitizeFileName('../../etc/passwd.csv')).toBe('passwd.csv');
  });

  it('strips control characters and falls back to a placeholder', () => {
    expect(sanitizeFileName('bad\u0000name.csv')).toBe('badname.csv');
    expect(sanitizeFileName('\u0000')).toBe('upload');
  });
});

describe('validateUpload', () => {
  it('accepts a csv file and returns the sanitized name', () => {
    const result = validateUpload(
      {
        fileName: '../data/faults.csv',
        mimeType: 'text/csv',
        sizeBytes: 12,
        head: Buffer.from('a,b\n1,2\n'),
      },
      LIMITS,
    );
    expect(result).toEqual({ fileName: 'faults.csv', format: 'csv', mimeType: 'text/csv' });
  });

  it('accepts an xlsx file by its zip magic bytes', () => {
    const result = validateUpload(
      {
        fileName: 'workbook.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 4,
        head: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      },
      LIMITS,
    );
    expect(result.format).toBe('xlsx');
  });

  it('rejects unsupported extensions', () => {
    expect(() =>
      validateUpload({ fileName: 'notes.pdf', mimeType: 'application/pdf', sizeBytes: 10 }, LIMITS),
    ).toThrow(UnsupportedFormatError);
  });

  it('rejects legacy .xls files with guidance', () => {
    expect(() =>
      validateUpload(
        { fileName: 'legacy.xls', mimeType: 'application/vnd.ms-excel', sizeBytes: 10 },
        LIMITS,
      ),
    ).toThrow(UnsupportedFormatError);
  });

  it('rejects a disallowed declared content type', () => {
    expect(() =>
      validateUpload({ fileName: 'data.csv', mimeType: 'application/pdf', sizeBytes: 10 }, LIMITS),
    ).toThrow(InvalidFileError);
  });

  it('rejects an empty file', () => {
    expect(() =>
      validateUpload({ fileName: 'data.csv', mimeType: 'text/csv', sizeBytes: 0 }, LIMITS),
    ).toThrow(InvalidFileError);
  });

  it('rejects a file that exceeds the configured limit', () => {
    expect(() =>
      validateUpload({ fileName: 'data.csv', mimeType: 'text/csv', sizeBytes: 2048 }, LIMITS),
    ).toThrow(OversizedFileError);
  });

  it('rejects a .xlsx that is not a zip archive', () => {
    expect(() =>
      validateUpload(
        {
          fileName: 'fake.xlsx',
          mimeType: 'application/octet-stream',
          sizeBytes: 8,
          head: Buffer.from('notzip!!'),
        },
        LIMITS,
      ),
    ).toThrow(CorruptFileError);
  });

  it('rejects binary content disguised as csv', () => {
    expect(() =>
      validateUpload(
        {
          fileName: 'data.csv',
          mimeType: 'text/csv',
          sizeBytes: 4,
          head: Buffer.from([0x00, 0x01, 0x02, 0x03]),
        },
        LIMITS,
      ),
    ).toThrow(CorruptFileError);
  });
});
