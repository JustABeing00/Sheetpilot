import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCellValue,
  formatDuration,
  formatPercent,
  humanizeToken,
} from './format.js';

describe('format helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(320)).toBe('320 ms');
    expect(formatDuration(2500)).toBe('2.50 s');
  });

  it('formats percentages', () => {
    expect(formatPercent(0.6667)).toBe('67%');
    expect(formatPercent(undefined)).toBe('—');
  });

  it('humanizes tokens', () => {
    expect(humanizeToken('no_rule_match')).toBe('No rule match');
    expect(humanizeToken('outputCsv')).toBe('Output Csv');
  });

  it('formats cell values', () => {
    expect(formatCellValue(null)).toBe('—');
    expect(formatCellValue(true)).toBe('Yes');
    expect(formatCellValue(3)).toBe('3');
  });
});
