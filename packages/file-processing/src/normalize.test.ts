import { describe, expect, it } from 'vitest';
import { formatIsoDateTime, normalizeKey, normalizeText, parseTimestamp } from './normalize.js';

describe('normalizeKey', () => {
  it('trims, collapses whitespace and upper-cases', () => {
    expect(normalizeKey('  acct 123 ')).toBe('ACCT 123');
    expect(normalizeKey('acct\u00a0123')).toBe('ACCT 123');
  });

  it('keeps leading zeros and handles non-string values', () => {
    expect(normalizeKey('00123')).toBe('00123');
    expect(normalizeKey(42)).toBe('42');
    expect(normalizeKey(null)).toBe('');
  });

  it('formats dates as ISO strings', () => {
    expect(normalizeKey(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
  });
});

describe('normalizeText', () => {
  it('preserves case while trimming and collapsing whitespace', () => {
    expect(normalizeText('  No   Power  Detected ')).toBe('No Power Detected');
  });
});

describe('parseTimestamp', () => {
  it('parses ISO date-times', () => {
    expect(parseTimestamp('2026-03-04T12:30:00Z')?.toISOString()).toBe('2026-03-04T12:30:00.000Z');
    expect(parseTimestamp('2026-03-04 12:30:00')?.toISOString()).toBe('2026-03-04T12:30:00.000Z');
  });

  it('parses year-first slash dates', () => {
    expect(parseTimestamp('2026/03/04 08:15')?.toISOString()).toBe('2026-03-04T08:15:00.000Z');
  });

  it('parses month-first and day-first dates according to options', () => {
    expect(parseTimestamp('03/04/2026')?.toISOString()).toBe('2026-03-04T00:00:00.000Z');
    expect(parseTimestamp('03/04/2026', { dayFirst: true })?.toISOString()).toBe(
      '2026-04-03T00:00:00.000Z',
    );
  });

  it('flips ambiguous day-first values when the month is impossible', () => {
    expect(parseTimestamp('13/04/2026', { dayFirst: true })?.toISOString()).toBe(
      '2026-04-13T00:00:00.000Z',
    );
    expect(parseTimestamp('13/04/2026')?.toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });

  it('converts excel serial numbers to dates', () => {
    expect(parseTimestamp(46023)?.toISOString().startsWith('2026-01-01')).toBe(true);
  });

  it('accepts Date instances', () => {
    const date = new Date('2026-05-06T07:08:09Z');
    expect(parseTimestamp(date)?.toISOString()).toBe(date.toISOString());
  });

  it('returns null for unparseable input', () => {
    expect(parseTimestamp('not a date')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp('2026-13-45')).toBeNull();
  });
});

describe('formatIsoDateTime', () => {
  it('omits milliseconds when zero', () => {
    expect(formatIsoDateTime(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:00:00Z');
    expect(formatIsoDateTime(new Date('2026-01-01T00:00:00.500Z'))).toBe(
      '2026-01-01T00:00:00.500Z',
    );
  });
});
