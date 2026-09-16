import { z } from 'zod';
import { confidenceSchema, outputValueSchema } from './entities.js';
import {
  decisionSourceSchema,
  reviewActionSchema,
  reviewItemStatusSchema,
  type ReviewItemStatus,
  type ReviewReason,
  type ReviewSeverity,
} from './enums.js';
import { ruleDecisionStatusSchema, ruleMatchSummarySchema } from './rules.js';

/**
 * The precise state a case is in, derived from the persisted review item (plus the automation that
 * produced it). `AUTO_RESOLVED` is never persisted on an item — it describes an account the
 * automation handled without a human ever being asked. `ERROR` marks a case where the assistive
 * automation failed and a human must decide instead.
 */
export const reviewStateSchema = z.enum([
  'AUTO_RESOLVED',
  'NEEDS_REVIEW',
  'APPROVED',
  'OVERRIDDEN',
  'DISMISSED',
  'ERROR',
]);
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  AUTO_RESOLVED: 'Auto-resolved',
  NEEDS_REVIEW: 'Needs review',
  APPROVED: 'Approved',
  OVERRIDDEN: 'Overridden',
  DISMISSED: 'Dismissed',
  ERROR: 'Processing error',
};

export interface ReviewStateInput {
  status: ReviewItemStatus;
  reason: ReviewReason;
}

/**
 * Single source of truth for the human-facing review state. The persisted item status stays the
 * auditable record; this is the derived vocabulary the queue and the decision log share.
 */
export function reviewStateForItem(item: ReviewStateInput): ReviewState {
  if (item.status === 'open') {
    return item.reason === 'ai_failed' ? 'ERROR' : 'NEEDS_REVIEW';
  }
  if (item.status === 'resolved_accepted') {
    return 'APPROVED';
  }
  if (item.status === 'resolved_overridden') {
    return 'OVERRIDDEN';
  }
  return 'DISMISSED';
}

/** A decision with no review item was handled entirely by automation. */
export function reviewStateForDecision(item: ReviewStateInput | null | undefined): ReviewState {
  return item ? reviewStateForItem(item) : 'AUTO_RESOLVED';
}

/**
 * Saved filter presets for "show me only what requires my attention". Each maps to a repository
 * query; `all` clears the filter. The definitions are shared by the API and the review UI so the
 * labels and the resulting sets can never drift.
 */
export const reviewFilterSchema = z.enum([
  'needs_review',
  'unresolved',
  'conflicts',
  'low_confidence',
  'processing_errors',
  'overridden',
  'resolved',
  'all',
]);
export type ReviewFilter = z.infer<typeof reviewFilterSchema>;

export interface ReviewFilterDefinition {
  key: ReviewFilter;
  label: string;
  description: string;
  statuses?: ReviewItemStatus[];
  reasons?: ReviewReason[];
  severities?: ReviewSeverity[];
}

const CONFLICT_REASONS: ReviewReason[] = [
  'rule_conflict',
  'conflicting_fault_history',
  'ambiguous_latest_timestamp',
];

export const REVIEW_FILTER_DEFINITIONS: ReviewFilterDefinition[] = [
  {
    key: 'needs_review',
    label: 'Needs review',
    description: 'Open cases waiting for a human decision.',
    statuses: ['open'],
  },
  {
    key: 'unresolved',
    label: 'Unresolved',
    description: 'Every case that has not been accepted, overridden or dismissed yet.',
    statuses: ['open'],
  },
  {
    key: 'conflicts',
    label: 'Conflicts',
    description: 'Rules, fault history or timestamps disagree about the latest case.',
    reasons: CONFLICT_REASONS,
  },
  {
    key: 'low_confidence',
    label: 'Low confidence',
    description: 'Classifications below the review threshold, deterministic or AI.',
    reasons: ['low_confidence', 'ai_low_confidence'],
  },
  {
    key: 'processing_errors',
    label: 'Processing errors',
    description: 'Cases where an assistive step (for example AI) failed and a human decides.',
    reasons: ['ai_failed'],
  },
  {
    key: 'overridden',
    label: 'Overridden',
    description: 'Cases a human changed away from the automated result.',
    statuses: ['resolved_overridden'],
  },
  {
    key: 'resolved',
    label: 'Resolved',
    description: 'Accepted, overridden or dismissed cases.',
    statuses: ['resolved_accepted', 'resolved_overridden', 'dismissed'],
  },
  {
    key: 'all',
    label: 'All',
    description: 'Every review item in the queue.',
  },
];

export function reviewFilterDefinition(filter: ReviewFilter): ReviewFilterDefinition {
  return (
    REVIEW_FILTER_DEFINITIONS.find((definition) => definition.key === filter) ??
    REVIEW_FILTER_DEFINITIONS[REVIEW_FILTER_DEFINITIONS.length - 1]!
  );
}

/** What the automation decided for an entity before any human touched it. */
export const reviewAutomationSchema = z.object({
  decisionSource: decisionSourceSchema.default('none'),
  confidence: confidenceSchema.nullable().default(null),
  matchedRuleIds: z.array(z.string()).default([]),
  values: z.record(z.string(), outputValueSchema).default({}),
  ruleStatus: ruleDecisionStatusSchema.nullable().default(null),
  explanation: z.string().default(''),
  applicableRules: z.array(ruleMatchSummarySchema).default([]),
});
export type ReviewAutomation = z.infer<typeof reviewAutomationSchema>;

export const reviewEventSchema = z.object({
  rowIndex: z.number().int().nonnegative().nullable().default(null),
  occurredAt: z.string().nullable().default(null),
  description: z.string().default(''),
  rootCause: z.string().nullable().default(null),
});
export type ReviewEvent = z.infer<typeof reviewEventSchema>;

/**
 * Append-only audit of every human review decision: what automation proposed, what the human
 * applied, exactly which fields changed and when. This is the record that lets a future session
 * learn from human corrections without recomputing history.
 */
export const reviewResolutionLogSchema = z.object({
  id: z.string().min(1),
  reviewItemId: z.string().min(1),
  runId: z.string().min(1),
  entityKey: z.string().min(1),
  action: reviewActionSchema,
  previousStatus: reviewItemStatusSchema,
  resultingState: reviewStateSchema,
  automation: reviewAutomationSchema,
  suggestedValues: z.record(z.string(), outputValueSchema).default({}),
  appliedValues: z.record(z.string(), outputValueSchema).default({}),
  changedFields: z.array(z.string()).default([]),
  note: z.string().default(''),
  resolvedBy: z.string().nullable().default(null),
  createdAt: z.date(),
});
export type ReviewResolutionLog = z.infer<typeof reviewResolutionLogSchema>;

/** Fields whose applied value differs from the automated value (order preserved). */
export function changedFields(
  automationValues: Record<string, unknown>,
  appliedValues: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(automationValues), ...Object.keys(appliedValues)]);
  return [...keys].filter((key) => automationValues[key] !== appliedValues[key]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Best-effort reconstruction of the automation block from persisted decision/review evidence. The
 * evidence shape is owned by the workflow, so parsing is tolerant: an unknown shape degrades to the
 * fallback values instead of throwing.
 */
export function reviewAutomationFromEvidence(
  evidence: Record<string, unknown>,
  fallbackValues: Record<string, unknown> = {},
): ReviewAutomation {
  const source = decisionSourceSchema.safeParse(evidence['decisionSource']);
  const confidence = confidenceSchema.safeParse(evidence['confidence']);
  const ruleStatus = ruleDecisionStatusSchema.safeParse(evidence['ruleStatus']);
  const matchedRuleIds = Array.isArray(evidence['matchedRuleIds'])
    ? evidence['matchedRuleIds'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  const values = asRecord(evidence['resultingValues']);
  const rules = Array.isArray(evidence['matchedRules'])
    ? evidence['matchedRules']
        .map((entry) => ruleMatchSummarySchema.safeParse(entry))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    : [];

  return reviewAutomationSchema.parse({
    decisionSource: source.success ? source.data : 'none',
    confidence: confidence.success ? confidence.data : null,
    matchedRuleIds,
    values: Object.keys(values).length > 0 ? values : fallbackValues,
    ruleStatus: ruleStatus.success ? ruleStatus.data : null,
    explanation: typeof evidence['explanation'] === 'string' ? evidence['explanation'] : '',
    applicableRules: rules,
  });
}

/** The most recent event and the earlier history a reviewer needs, derived from review evidence. */
export function reviewEventsFromEvidence(evidence: Record<string, unknown>): {
  latestEvent: ReviewEvent | null;
  history: ReviewEvent[];
} {
  const latest = asRecord(evidence['latestFault']);
  const latestEvent =
    Object.keys(latest).length > 0
      ? reviewEventSchema.parse({
          rowIndex: typeof latest['rowIndex'] === 'number' ? latest['rowIndex'] : null,
          occurredAt: typeof latest['occurredAt'] === 'string' ? latest['occurredAt'] : null,
          description: typeof latest['description'] === 'string' ? latest['description'] : '',
          rootCause: null,
        })
      : null;

  const earlier = Array.isArray(evidence['earlierFaults']) ? evidence['earlierFaults'] : [];
  const history = earlier.flatMap((entry) => {
    const parsed = reviewEventSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });

  return { latestEvent, history };
}
