import { apiErrorBodySchema } from '@sheetpilot/core';
import type { ZodType } from 'zod';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/** Absolute URL for an API path (same-origin in production, through the Worker proxy). */
export function apiUrl(path: string): string {
  return `${baseUrl}${path}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const parsed = apiErrorBodySchema.safeParse(body);
  if (parsed.success) {
    return new ApiError(
      response.status,
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.details,
    );
  }

  return new ApiError(
    response.status,
    'request_failed',
    `Request failed with status ${response.status}`,
  );
}

async function parseResponse<T>(response: Response, schema: ZodType<T>): Promise<T> {
  const body: unknown = await response.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The API returned an unexpected response shape',
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return parseResponse(response, schema);
}

export async function apiPost<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return parseResponse(response, schema);
}

export async function apiPut<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return parseResponse(response, schema);
}

export async function apiUpload<T>(path: string, form: FormData, schema: ZodType<T>): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    body: form,
    headers: { accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return parseResponse(response, schema);
}

export function apiDownloadUrl(path: string): string {
  return `${baseUrl}${path}`;
}
