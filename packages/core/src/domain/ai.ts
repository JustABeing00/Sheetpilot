import { z } from 'zod';
import { classificationOptionSchema, confidenceSchema, outputValueSchema } from './entities.js';

/**
 * Why the AI layer was (or was not) consulted for a record. Recorded verbatim in decision evidence
 * so the provenance of every classification is auditable.
 */
export const aiConsultReasonSchema = z.enum([
  'policy_never',
  'policy_always',
  'no_rule_match',
  'low_confidence',
  'rules_sufficient',
]);
export type AiConsultReason = z.infer<typeof aiConsultReasonSchema>;

/** Structured ambiguity indicators the model must report rather than hiding in prose. */
export const aiAmbiguityFlagSchema = z.enum([
  'ambiguous_wording',
  'multiple_candidates',
  'insufficient_history',
  'conflicting_evidence',
  'unknown_terminology',
  'missing_context',
  'other',
]);
export type AiAmbiguityFlag = z.infer<typeof aiAmbiguityFlagSchema>;

/** Normalized failure kinds so the pipeline can react consistently regardless of provider. */
export const aiFailureKindSchema = z.enum([
  'timeout',
  'rate_limited',
  'invalid_credentials',
  'unavailable',
  'provider_error',
  'malformed_response',
  'unexpected_classification',
]);
export type AiFailureKind = z.infer<typeof aiFailureKindSchema>;

/** A single event as sent to the provider. Only the fields the model needs, never the raw row. */
export const aiEventSummarySchema = z.object({
  rowIndex: z.number().int().nonnegative().nullable().default(null),
  occurredAt: z.string().nullable().default(null),
  description: z.string().default(''),
  fields: z.record(z.string(), outputValueSchema).default({}),
});
export type AiEventSummary = z.infer<typeof aiEventSummarySchema>;

/** A deterministic rule the model may use as context (already evaluated by the rule engine). */
export const aiRuleSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  priority: z.number().int(),
  confidence: confidenceSchema,
  description: z.string().default(''),
});
export type AiRuleSummary = z.infer<typeof aiRuleSummarySchema>;

/**
 * A classification target the model must choose from. `values` carries the output values implied by
 * the target so an accepted AI proposal maps onto the same columns as a rule action.
 */
export const aiClassificationTargetSchema = classificationOptionSchema.extend({
  values: z.record(z.string(), outputValueSchema).default({}),
});
export type AiClassificationTarget = z.infer<typeof aiClassificationTargetSchema>;

/** The structured, bounded input sent to a provider. */
export const aiClassificationRequestSchema = z.object({
  entityKey: z.string().nullable().default(null),
  latestEvent: aiEventSummarySchema.nullable().default(null),
  eventHistory: z.array(aiEventSummarySchema).default([]),
  targets: z.array(aiClassificationTargetSchema).min(1),
  applicableRules: z.array(aiRuleSummarySchema).default([]),
  hints: z.record(z.string(), z.string()).default({}),
  /** Field names removed before the request left the process (for transparency in evidence). */
  redactedFields: z.array(z.string()).default([]),
});
export type AiClassificationRequest = z.infer<typeof aiClassificationRequestSchema>;

/** The strict, validated shape a provider must return. Arbitrary prose is never accepted. */
export const aiClassificationResultSchema = z.object({
  proposedCode: z.string().min(1).nullable().default(null),
  proposedLabel: z.string().default(''),
  confidence: confidenceSchema,
  reasoning: z.string().default(''),
  ambiguity: z.array(aiAmbiguityFlagSchema).default([]),
  missingInformation: z.array(z.string()).default([]),
});
export type AiClassificationResult = z.infer<typeof aiClassificationResultSchema>;

/**
 * The normalized outcome of an AI consultation. This is what gets stored in decision evidence; it
 * never throws and never replaces a deterministic result on its own.
 */
export const aiAssistOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('not_consulted'),
    reason: aiConsultReasonSchema,
  }),
  z.object({
    status: z.literal('disabled'),
    reason: z.string().default('provider_unavailable'),
  }),
  z.object({
    status: z.literal('skipped'),
    reason: z.enum(['no_event', 'no_targets']),
  }),
  z.object({
    status: z.literal('no_suggestion'),
    reason: z.string().default('model_abstained'),
  }),
  z.object({
    status: z.literal('suggested'),
    providerId: z.string().min(1),
    model: z.string().nullable().default(null),
    result: aiClassificationResultSchema,
    /** Output values implied by the chosen target (empty when the model abstained). */
    values: z.record(z.string(), outputValueSchema).default({}),
  }),
  z.object({
    status: z.literal('failed'),
    failure: aiFailureKindSchema,
    message: z.string().default(''),
    attempts: z.number().int().nonnegative().default(0),
  }),
]);
export type AiAssistOutcome = z.infer<typeof aiAssistOutcomeSchema>;

export const AI_CONSULT_REASON_LABELS: Record<AiConsultReason, string> = {
  policy_never: 'AI disabled by policy',
  policy_always: 'AI consulted by policy',
  no_rule_match: 'No rule matched',
  low_confidence: 'Rule confidence below threshold',
  rules_sufficient: 'Rules were sufficient',
};

export const AI_FAILURE_LABELS: Record<AiFailureKind, string> = {
  timeout: 'The AI provider timed out',
  rate_limited: 'The AI provider rate-limited the request',
  invalid_credentials: 'The AI provider rejected the credentials',
  unavailable: 'The AI provider was unreachable',
  provider_error: 'The AI provider returned an error',
  malformed_response: 'The AI provider returned an invalid response',
  unexpected_classification: 'The AI provider proposed an unknown classification',
};

export const AI_AMBIGUITY_LABELS: Record<AiAmbiguityFlag, string> = {
  ambiguous_wording: 'Ambiguous wording',
  multiple_candidates: 'Several plausible classes',
  insufficient_history: 'Insufficient history',
  conflicting_evidence: 'Conflicting evidence',
  unknown_terminology: 'Unknown terminology',
  missing_context: 'Missing context',
  other: 'Other ambiguity',
};
