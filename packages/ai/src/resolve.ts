import type { AiAssistOutcome, DecisionSource, OutputValue, ReviewReason } from '@sheetpilot/core';

export type AiAgreement = 'agrees' | 'disagrees' | 'no_baseline';

export interface DeterministicOutcome {
  matched: boolean;
  confidence: number;
  values: Record<string, OutputValue>;
}

export interface ResolveAssistedInput {
  deterministic: DeterministicOutcome;
  outcome: AiAssistOutcome;
  /** Rule confidence below which a deterministic result needs review. */
  reviewBelowConfidence: number;
  /** AI confidence below which an AI-sourced result needs review. */
  aiMinConfidence: number;
  /** When false (default) an AI-sourced classification always needs human confirmation. */
  aiAutoApprove: boolean;
  /** Business column used to compare an AI proposal with a deterministic result. */
  agreementField?: string;
}

export interface AssistedDecision {
  source: DecisionSource;
  /** True when the AI-proposed values are the ones written to the output. */
  applied: boolean;
  agreement: AiAgreement | null;
  values: Record<string, OutputValue>;
  confidence: number;
  /** AI-originated review reasons only; the caller merges its own deterministic reasons. */
  aiReviewReasons: ReviewReason[];
}

function compare(
  deterministic: DeterministicOutcome,
  outcome: Extract<AiAssistOutcome, { status: 'suggested' }>,
  agreementField: string | undefined,
): AiAgreement {
  const keys = Object.keys(deterministic.values);
  if (!deterministic.matched || keys.length === 0) {
    return 'no_baseline';
  }
  const field = agreementField ?? keys[0]!;
  const aiValue = outcome.values[field];
  if (aiValue === undefined) {
    return 'no_baseline';
  }
  return String(aiValue) === String(deterministic.values[field]) ? 'agrees' : 'disagrees';
}

/**
 * Combines a deterministic rule result with an AI outcome under the product's core guardrail:
 * **AI never overrides a deterministic result.** It can corroborate a weak rule (raising confidence
 * when auto-approval is enabled) and it can supply values only when no rule matched.
 *
 * The returned `aiReviewReasons` are the AI-originated flags; the caller keeps ownership of the
 * deterministic review reasons so existing behaviour is unchanged when AI is disabled.
 */
export function resolveAssistedDecision(input: ResolveAssistedInput): AssistedDecision {
  const { deterministic, outcome } = input;
  const deterministicConfident =
    deterministic.matched && deterministic.confidence >= input.reviewBelowConfidence;
  const suggestion = outcome.status === 'suggested' ? outcome : null;

  // A confident deterministic rule always wins; AI may only raise a disagreement for review.
  if (deterministicConfident) {
    const agreement = suggestion ? compare(deterministic, suggestion, input.agreementField) : null;
    return {
      source: 'deterministic',
      applied: false,
      agreement,
      values: deterministic.values,
      confidence: deterministic.confidence,
      aiReviewReasons: agreement === 'disagrees' ? ['ai_proposed_alternative'] : [],
    };
  }

  // A weak deterministic match is kept; AI can corroborate it but never replace it.
  if (deterministic.matched) {
    if (!suggestion) {
      return {
        source: 'deterministic',
        applied: false,
        agreement: null,
        values: deterministic.values,
        confidence: deterministic.confidence,
        aiReviewReasons: outcome.status === 'failed' ? ['ai_failed'] : [],
      };
    }
    const agreement = compare(deterministic, suggestion, input.agreementField);
    if (agreement === 'agrees') {
      const corroborated =
        input.aiAutoApprove && suggestion.result.confidence >= input.aiMinConfidence;
      return {
        source: 'deterministic',
        applied: false,
        agreement,
        values: deterministic.values,
        confidence: corroborated
          ? Math.max(deterministic.confidence, suggestion.result.confidence)
          : deterministic.confidence,
        aiReviewReasons: [],
      };
    }
    return {
      source: 'deterministic',
      applied: false,
      agreement,
      values: deterministic.values,
      confidence: deterministic.confidence,
      aiReviewReasons: agreement === 'disagrees' ? ['ai_proposed_alternative'] : [],
    };
  }

  // No rule matched: this is the only path where AI may supply the output values.
  if (!suggestion) {
    return {
      source: 'none',
      applied: false,
      agreement: null,
      values: {},
      confidence: 0,
      aiReviewReasons: outcome.status === 'failed' ? ['ai_failed'] : [],
    };
  }

  const { result, values } = suggestion;
  const ambiguous = result.ambiguity.length > 0 || result.missingInformation.length > 0;
  const confident = result.confidence >= input.aiMinConfidence;

  if (confident && !ambiguous && input.aiAutoApprove) {
    return {
      source: 'ai_suggested',
      applied: true,
      agreement: 'no_baseline',
      values,
      confidence: result.confidence,
      aiReviewReasons: [],
    };
  }

  const aiReviewReasons: ReviewReason[] = [];
  if (!confident) {
    aiReviewReasons.push('ai_low_confidence');
  }
  if (ambiguous) {
    aiReviewReasons.push('ai_ambiguous');
  }

  return {
    source: 'ai_suggested',
    applied: true,
    agreement: 'no_baseline',
    values,
    confidence: result.confidence,
    aiReviewReasons,
  };
}
