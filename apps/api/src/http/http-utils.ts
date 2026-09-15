import { ValidationError, formatZodError } from '@sheetpilot/core';
import type { ZodType } from 'zod';

export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid ${label}: ${formatZodError(result.error)}`, {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function clampLimit(value: unknown, fallback = 100, max = 500): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

export function parseOffset(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function fieldValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

export function firstFieldValue(value: unknown): string | null {
  const candidate: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;

  if (candidate && typeof candidate === 'object' && 'value' in candidate) {
    return fieldValue(candidate.value);
  }

  return fieldValue(candidate);
}
