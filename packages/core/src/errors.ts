import type { ZodError, ZodType } from 'zod';

export interface AppErrorOptions {
  code: string;
  statusCode: number;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'validation_error', statusCode: 400, details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} '${id}' was not found` : `${resource} was not found`, {
      code: 'not_found',
      statusCode: 404,
      details: { resource, id },
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'conflict', statusCode: 409, details });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'payload_too_large', statusCode: 413, details });
  }
}

export class UnsupportedFormatError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'unsupported_format', statusCode: 415, details });
  }
}

export class InvalidFileError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'invalid_file', statusCode: 400, details });
  }
}

export class CorruptFileError extends AppError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, { code: 'corrupt_file', statusCode: 422, details, cause });
  }
}

export class EmptyDatasetError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'empty_dataset', statusCode: 422, details });
  }
}

export class OversizedFileError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'payload_too_large', statusCode: 413, details });
  }
}

export class ProcessingError extends AppError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, { code: 'processing_error', statusCode: 422, details, cause });
  }
}

export class InvalidConfigurationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'invalid_configuration', statusCode: 422, details });
  }
}

export class StorageError extends AppError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, { code: 'storage_error', statusCode: 500, details, cause });
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'configuration_error', statusCode: 500, details });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

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

export interface PublicErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function toPublicErrorBody(error: unknown): PublicErrorBody {
  if (isAppError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }
  return {
    error: {
      code: 'internal_error',
      message: 'An unexpected internal error occurred',
    },
  };
}
