import { describe, expect, it } from 'vitest';
import { normalizeKey } from '@sheetpilot/file-processing';
import { normalizeIdentifier, renderCellText } from './normalize.js';

function codes(value: unknown, options?: Parameters<typeof normalizeIdentifier>[1]) {
  return normalizeIdentifier(value, options).transformations.map((entry) => entry.code);
}

describe('normalizeIdentifier', () => {
  it('returns an empty key for blank values without transformations', () => {
    for (const value of [null, undefined, '']) {
      const result = normalizeIdentifier(value);
      expect(result).toEqual({
        raw: '',
        key: '',
        transformations: [],
        dangerous: false,
      });
    }
  });

  it('trims, collapses whitespace, normalizes non-breaking spaces and upper-cases by default', () => {
    const result = normalizeIdentifier('  acct\u00a0  no  ');

    expect(result.key).toBe('ACCT NO');
    expect(result.raw).toBe('  acct\u00a0  no  ');
    expect(result.transformations.map((entry) => entry.code)).toEqual([
      'normalize-non-breaking-space',
      'trim',
      'collapse-whitespace',
      'upper-case',
    ]);
    expect(result.dangerous).toBe(false);
  });

  it('converts a lone tab to a single space even though it is not a run', () => {
    // `normalizeKey` collapses every whitespace character, so a single tab must become a space.
    expect(normalizeIdentifier('ab\tcd').key).toBe('AB CD');
  });

  it('preserves the raw value for strings', () => {
    expect(normalizeIdentifier('  hello ').raw).toBe('  hello ');
  });

  it('can disable case folding', () => {
    expect(normalizeIdentifier('AbC', { upperCase: false }).key).toBe('AbC');
    expect(normalizeIdentifier('AbC', { upperCase: false }).transformations).toEqual([]);
  });

  it('keeps the key stable when a step makes no change', () => {
    expect(normalizeIdentifier('ALREADY NORMAL').transformations).toEqual([]);
    expect(normalizeIdentifier('ALREADY NORMAL').key).toBe('ALREADY NORMAL');
  });

  it('is idempotent for string values', () => {
    const first = normalizeIdentifier('  acct\u00a0  no  ').key;
    const second = normalizeIdentifier(first).key;
    expect(second).toBe(first);
    expect(normalizeIdentifier(first).transformations).toEqual([]);
  });

  it('unifies numeric and numeric-string representations', () => {
    expect(normalizeIdentifier(1001).key).toBe('1001');
    expect(normalizeIdentifier('1001').key).toBe('1001');
    expect(normalizeIdentifier('1001').transformations).toEqual([]);
    expect(codes(1001)).toEqual(['coerce-number']);
  });

  it('stringifies booleans and dates without text mangling', () => {
    expect(normalizeIdentifier(true).key).toBe('true');
    expect(normalizeIdentifier(false).key).toBe('false');
    const date = new Date('2026-03-01T10:00:00.000Z');
    expect(normalizeIdentifier(date).key).toBe('2026-03-01T10:00:00.000Z');
    expect(normalizeIdentifier(new Date('nope')).key).toBe('');
  });

  it('does not strip leading zeros unless explicitly enabled', () => {
    expect(normalizeIdentifier('007').key).toBe('007');
    expect(normalizeIdentifier('007').dangerous).toBe(false);

    const stripped = normalizeIdentifier('007', { stripLeadingZeros: true });
    expect(stripped.key).toBe('7');
    expect(stripped.dangerous).toBe(true);
    expect(codes('007', { stripLeadingZeros: true })).toEqual(['strip-leading-zeros']);
  });

  it('keeps a single leading zero before a non-digit', () => {
    const result = normalizeIdentifier('0A1', { stripLeadingZeros: true });
    expect(result.key).toBe('0A1');
    expect(result.transformations).toEqual([]);
  });

  it('does not strip separators unless explicitly enabled, and flags it as dangerous', () => {
    expect(normalizeIdentifier('12-34 56').key).toBe('12-34 56');

    const stripped = normalizeIdentifier('12-34 56', { stripSeparators: true });
    expect(stripped.key).toBe('123456');
    expect(stripped.dangerous).toBe(true);
    expect(codes('12-34 56', { stripSeparators: true })).toEqual(['strip-separators']);
  });

  it('matches the canonical file-processing normalizeKey for the default options', () => {
    const samples: unknown[] = [
      '  acct\u00a0  no  ',
      'Mixed Case',
      '1001',
      1001,
      true,
      'ab\tcd',
      '   ',
      '007',
      null,
      undefined,
    ];
    for (const value of samples) {
      expect(normalizeIdentifier(value).key).toBe(
        normalizeKey(value as Parameters<typeof normalizeKey>[0]),
      );
    }
  });

  it('reports when a dangerous step did not actually change the value', () => {
    const result = normalizeIdentifier('ABC', {
      stripSeparators: true,
      stripLeadingZeros: true,
    });
    expect(result.transformations).toEqual([]);
    expect(result.dangerous).toBe(false);
  });

  it('renders cell-like values consistently', () => {
    expect(renderCellText(null)).toBe('');
    expect(renderCellText(undefined)).toBe('');
    expect(renderCellText(12)).toBe('12');
    expect(renderCellText(true)).toBe('true');
    expect(renderCellText('x')).toBe('x');
  });
});
