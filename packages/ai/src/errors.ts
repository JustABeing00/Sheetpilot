import type { AiFailureKind } from '@sheetpilot/core';

/**
 * Raised by a provider adapter when a request cannot be completed or its response cannot be trusted.
 * The orchestration layer (`AiClassificationService`) converts this into a reviewable outcome and
 * never lets it fail a run.
 */
export class AiProviderError extends Error {
  readonly kind: AiFailureKind;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { kind: AiFailureKind; retryable: boolean; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AiProviderError';
    this.kind = options.kind;
    this.retryable = options.retryable;
  }
}

export function isAiProviderError(error: unknown): error is AiProviderError {
  return error instanceof AiProviderError;
}

/**
 * Maps an arbitrary thrown value to a provider error. Unknown errors are treated as retryable
 * provider errors so a transient adapter/network bug does not permanently disable assistance.
 */
export function toAiProviderError(error: unknown): AiProviderError {
  if (isAiProviderError(error)) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new AiProviderError('AI request aborted', {
      kind: 'timeout',
      retryable: false,
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AiProviderError(message, {
    kind: 'provider_error',
    retryable: true,
    cause: error,
  });
}
