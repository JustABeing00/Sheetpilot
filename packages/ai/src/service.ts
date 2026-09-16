import type {
  AiAssistOutcome,
  AiClassificationRequest,
  AiClassificationTarget,
  AiPolicy,
  ClassificationProvider,
  Logger,
  RuleEvaluation,
} from '@sheetpilot/core';
import { decideAiUsage } from './policy.js';
import { toAiProviderError, type AiProviderError } from './errors.js';
import { sleep, withTimeout } from './resilience.js';
import {
  redactClassificationRequest,
  DEFAULT_AI_REDACTION,
  type AiRedactionPolicy,
} from './redact.js';

export interface AiServiceOptions {
  /** Hard deadline for a single provider call. */
  timeoutMs?: number;
  /** Total attempts (1 = no retries). Only retryable failures are retried. */
  maxAttempts?: number;
  /** Base backoff between attempts; multiplied by the attempt number. */
  backoffMs?: number;
  /** What may leave the process. Defaults to the safest possible policy. */
  redaction?: Partial<AiRedactionPolicy>;
  logger?: Logger;
}

export interface AiAssistInput {
  request: AiClassificationRequest;
  policy: AiPolicy;
  reviewBelowConfidence: number;
  ruleEvaluation: RuleEvaluation;
  signal?: AbortSignal;
}

/** A normalized outcome plus the provenance the caller stores in decision evidence. */
export interface AiAssistResult {
  outcome: AiAssistOutcome;
  providerId: string;
  model: string | null;
  redactedFields: string[];
}

function findByCode(
  targets: AiClassificationTarget[],
  code: string,
): AiClassificationTarget | undefined {
  return targets.find((target) => target.code === code);
}

/**
 * Orchestrates a single AI consultation: policy gating, redaction, timeout, bounded retries,
 * strict response validation and normalized failure handling.
 *
 * Invariants:
 * - It never throws (except when the surrounding run is aborted, so cancellation propagates).
 * - It never decides the final output; that is `resolveAssistedDecision`'s job.
 * - A malformed/failed consultation is a first-class `failed` outcome, not an exception.
 */
export class AiClassificationService {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly redaction: AiRedactionPolicy;

  constructor(
    private readonly provider: ClassificationProvider,
    private readonly options: AiServiceOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.backoffMs = Math.max(0, options.backoffMs ?? 250);
    this.redaction = { ...DEFAULT_AI_REDACTION, ...options.redaction };
  }

  get providerId(): string {
    return this.provider.id;
  }

  get model(): string | null {
    return this.provider.model;
  }

  isAvailable(): boolean {
    return this.provider.isAvailable();
  }

  async assist(input: AiAssistInput): Promise<AiAssistResult> {
    const wrap = (outcome: AiAssistOutcome, redactedFields: string[] = []): AiAssistResult => ({
      outcome,
      providerId: this.provider.id,
      model: this.provider.model,
      redactedFields,
    });

    const decision = decideAiUsage(input.policy, {
      ruleEvaluation: input.ruleEvaluation,
      confidenceThreshold: input.reviewBelowConfidence,
    });

    if (!decision.shouldConsult) {
      return wrap({ status: 'not_consulted', reason: decision.reason });
    }
    if (!this.provider.isAvailable()) {
      return wrap({ status: 'disabled', reason: 'provider_unavailable' });
    }
    if (!input.request.latestEvent) {
      return wrap({ status: 'skipped', reason: 'no_event' });
    }
    if (input.request.targets.length === 0) {
      return wrap({ status: 'skipped', reason: 'no_targets' });
    }

    const { request, redactedFields } = redactClassificationRequest(input.request, this.redaction);
    if (redactedFields.length > 0) {
      this.options.logger?.debug(
        { providerId: this.provider.id, redactedFields },
        'redacted fields before AI consultation',
      );
    }

    let lastError: AiProviderError | null = null;
    let attempts = 0;

    while (attempts < this.maxAttempts) {
      attempts += 1;
      try {
        const result = await withTimeout((signal) => this.provider.classify(request, signal), {
          timeoutMs: this.timeoutMs,
          signal: input.signal,
        });

        if (result.proposedCode === null) {
          return wrap({ status: 'no_suggestion', reason: 'model_abstained' }, redactedFields);
        }

        const target = findByCode(request.targets, result.proposedCode);
        if (!target) {
          return wrap(
            {
              status: 'failed',
              failure: 'unexpected_classification',
              message: `AI proposed classification '${result.proposedCode}' which is not a configured target`,
              attempts,
            },
            redactedFields,
          );
        }

        return wrap(
          {
            status: 'suggested',
            providerId: this.provider.id,
            model: this.provider.model,
            result,
            values: target.values,
          },
          redactedFields,
        );
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        const providerError = toAiProviderError(error);
        lastError = providerError;
        this.options.logger?.warn(
          {
            providerId: this.provider.id,
            failure: providerError.kind,
            attempt: attempts,
            retryable: providerError.retryable,
          },
          'AI consultation attempt failed',
        );
        if (!providerError.retryable || attempts >= this.maxAttempts) {
          break;
        }
        await sleep(this.backoffMs * attempts, input.signal);
      }
    }

    return wrap(
      {
        status: 'failed',
        failure: lastError?.kind ?? 'provider_error',
        message: lastError?.message ?? 'AI consultation failed',
        attempts,
      },
      redactedFields,
    );
  }
}
