import type { CellValue } from './table.js';

export interface ParseTimestampOptions {
  dayFirst?: boolean;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

const ISO_LIKE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const SLASH_YMD = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const SLASH_DMY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

export function normalizeKey(value: CellValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return value
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function normalizeText(value: CellValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return value
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function fromParts(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2958466) {
    return null;
  }
  const ms = EXCEL_EPOCH_MS + Math.round(serial * MS_PER_DAY);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseTimestamp(
  value: CellValue | undefined,
  options: ParseTimestampOptions = {},
): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === 'number') {
    return excelSerialToDate(value);
  }

  if (typeof value === 'boolean') {
    return null;
  }

  const text = value.trim();
  if (text.length === 0) {
    return null;
  }

  const iso = ISO_LIKE.exec(text);
  if (iso) {
    const [, year, month, day, hours, minutes, seconds, millis, offset] = iso;
    const base = fromParts(
      Number(year),
      Number(month),
      Number(day),
      Number(hours ?? 0),
      Number(minutes ?? 0),
      Number(seconds ?? 0),
      Number((millis ?? '0').padEnd(3, '0')),
    );
    if (!base) {
      return null;
    }
    if (offset === undefined) {
      return base;
    }
    if (offset === 'Z') {
      return base;
    }
    const sign = offset.startsWith('-') ? -1 : 1;
    const [offsetHours, offsetMinutes] = offset.slice(1).replace(':', '').match(/\d{2}/g) ?? [];
    const offsetMs = sign * (Number(offsetHours ?? 0) * 60 + Number(offsetMinutes ?? 0)) * 60_000;
    return new Date(base.getTime() - offsetMs);
  }

  const slashYmd = SLASH_YMD.exec(text);
  if (slashYmd) {
    const [, year, month, day, hours, minutes, seconds] = slashYmd;
    return fromParts(
      Number(year),
      Number(month),
      Number(day),
      Number(hours ?? 0),
      Number(minutes ?? 0),
      Number(seconds ?? 0),
    );
  }

  const slashDmy = SLASH_DMY.exec(text);
  if (slashDmy) {
    const [, first, second, year, hours, minutes, seconds] = slashDmy;
    const dayFirst = options.dayFirst ?? false;
    const month = Number(dayFirst ? second : first);
    const day = Number(dayFirst ? first : second);
    if (month > 12 && day <= 12) {
      return fromParts(
        Number(year),
        day,
        month,
        Number(hours ?? 0),
        Number(minutes ?? 0),
        Number(seconds ?? 0),
      );
    }
    return fromParts(
      Number(year),
      month,
      day,
      Number(hours ?? 0),
      Number(minutes ?? 0),
      Number(seconds ?? 0),
    );
  }

  const fallback = Date.parse(text);
  return Number.isNaN(fallback) ? null : new Date(fallback);
}

export function formatIsoDateTime(date: Date): string {
  return date.toISOString().replace('.000Z', 'Z');
}
