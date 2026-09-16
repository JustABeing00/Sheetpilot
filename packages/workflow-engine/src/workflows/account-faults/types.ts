import { z } from 'zod';
import {
  aiPolicySchema,
  ruleSetSchema,
  type AiAssistOutcome,
  type AiConsultReason,
  type DecisionSource,
  type MetricRecord,
  type OutputValue,
  type ReviewReason,
  type ReviewSeverity,
  type RuleEvaluation,
  type RuleSet,
  type WorkflowConfigField,
} from '@sheetpilot/core';
import type { Row } from '@sheetpilot/file-processing';
import type { AiAgreement } from '@sheetpilot/ai';
import type { AppliedAction } from '@sheetpilot/rule-engine';
import type { NewDecisionRecord, NewReviewItem } from '../../types.js';

export const accountFaultConfigSchema = z
  .object({
    primaryAccountColumn: z.string().min(1).default('Account Number'),
    eventsAccountColumn: z.string().min(1).default('Account Number'),
    eventsTimestampColumn: z.string().min(1).default('Fault Date'),
    eventsDescriptionColumn: z.string().min(1).default('Fault Description'),
    primaryOutputColumns: z.array(z.string()).default([]),
    reviewBelowConfidence: z.number().min(0).max(1).default(0.8),
    aiMinConfidence: z.number().min(0).max(1).default(0.85),
    aiAutoApprove: z.boolean().default(false),
    includeSystemColumns: z.boolean().default(true),
    aiPolicy: aiPolicySchema.default('on_no_rule_match'),
    dayFirstDates: z.boolean().default(false),
    maxEvidenceFaults: z.number().int().min(1).max(50).default(5),
  })
  .strict();

export type AccountFaultConfig = z.infer<typeof accountFaultConfigSchema>;

export const ACCOUNT_FAULT_CONFIG_FIELDS: WorkflowConfigField[] = [
  {
    key: 'primaryAccountColumn',
    label: 'Primary file: account column',
    kind: 'column',
    required: true,
    defaultValue: 'Account Number',
    description: 'Column in the primary file that identifies the account or entity.',
  },
  {
    key: 'eventsAccountColumn',
    label: 'Events file: account column',
    kind: 'column',
    required: true,
    defaultValue: 'Account Number',
    description: 'Column in the events file that links a fault to an account.',
  },
  {
    key: 'eventsTimestampColumn',
    label: 'Events file: date/time column',
    kind: 'column',
    required: true,
    defaultValue: 'Fault Date',
    description: 'Column used to determine the latest fault per account.',
  },
  {
    key: 'eventsDescriptionColumn',
    label: 'Events file: description column',
    kind: 'column',
    required: true,
    defaultValue: 'Fault Description',
    description: 'Free-text description that rules are evaluated against.',
  },
  {
    key: 'reviewBelowConfidence',
    label: 'Review below confidence',
    kind: 'number',
    required: false,
    defaultValue: 0.8,
    description: 'Classifications below this confidence are queued for manual review.',
  },
  {
    key: 'includeSystemColumns',
    label: 'Include system columns',
    kind: 'boolean',
    required: false,
    defaultValue: true,
    description: 'Add __ prefixed traceability columns to the generated output.',
  },
  {
    key: 'aiPolicy',
    label: 'AI assistance policy',
    kind: 'text',
    required: false,
    defaultValue: 'on_no_rule_match',
    description:
      'When AI may be consulted (never, on_no_rule_match, on_low_confidence, always). Deterministic rule matches are never overridden.',
  },
  {
    key: 'aiMinConfidence',
    label: 'Minimum AI confidence',
    kind: 'number',
    required: false,
    defaultValue: 0.85,
    description: 'AI proposals below this confidence are always routed to a human reviewer.',
  },
  {
    key: 'aiAutoApprove',
    label: 'Auto-approve confident AI results',
    kind: 'boolean',
    required: false,
    defaultValue: false,
    description:
      'When false (recommended), any AI-sourced classification requires human review even when confident. Deterministic results are unaffected.',
  },
  {
    key: 'dayFirstDates',
    label: 'Parse dates as day-first',
    kind: 'boolean',
    required: false,
    defaultValue: false,
    description: 'Interpret ambiguous dates such as 03/04/2026 as DD/MM/YYYY.',
  },
];

export const ACCOUNT_FAULT_BUSINESS_COLUMNS = [
  'RootCause',
  'FaultCategory',
  'RecommendedAction',
  'Priority',
] as const;

export const ACCOUNT_FAULT_SYSTEM_COLUMNS = [
  '__FaultCount',
  '__LatestFaultAt',
  '__MatchedRules',
  '__DecisionSource',
  '__DecisionConfidence',
  '__ReviewStatus',
  '__ReviewReasons',
  '__Explanation',
] as const;

export const accountFaultInputSchema = z.object({
  primaryFileId: z.string().min(1),
  eventsFileId: z.string().min(1),
  config: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .default({}),
  /**
   * Rule set to evaluate. When omitted (e.g. direct engine tests) the workflow falls back to the
   * in-code default. The API always supplies the persisted active rule set for the workflow.
   */
  ruleSet: ruleSetSchema.optional(),
});
export type AccountFaultInput = z.infer<typeof accountFaultInputSchema>;

export interface PrimaryRecord {
  rowIndex: number;
  account: string;
  accountRaw: string;
  row: Row;
}

export interface EventRecord {
  rowIndex: number;
  account: string;
  accountRaw: string;
  occurredAt: Date | null;
  occurredAtRaw: string;
  description: string;
  row: Row;
}

export interface AccountGroup {
  account: string;
  primaries: PrimaryRecord[];
  events: EventRecord[];
}

export interface EarlierFaultEvidence {
  rowIndex: number;
  occurredAt: string | null;
  description: string;
  rootCause: string | null;
}

export interface EntityDecision {
  account: string;
  faultCount: number;
  latestFault: { rowIndex: number; occurredAt: string | null; description: string } | null;
  earlierFaults: EarlierFaultEvidence[];
  matchedRuleIds: string[];
  matchedTerm: string | null;
  explanation: string;
  conflicts: Array<{ ruleIds: string[]; field: string; values: string[]; reason: string }>;
  evaluation: RuleEvaluation;
  appliedActions: AppliedAction[];
  outputValues: Record<string, OutputValue>;
  confidence: number;
  decisionSource: DecisionSource;
  ai: {
    consulted: boolean;
    reason: AiConsultReason | null;
    providerId: string;
    model: string | null;
    outcome: AiAssistOutcome;
    agreement: AiAgreement | null;
    applied: boolean;
    redactedFields: string[];
  };
  reviewReasons: ReviewReason[];
  severity: ReviewSeverity | null;
}

export interface AccountFaultState {
  input: AccountFaultInput;
  config: AccountFaultConfig;
  rules: RuleSet;
  primaries: PrimaryRecord[];
  events: EventRecord[];
  groups: AccountGroup[];
  decisions: EntityDecision[];
  primaryColumns: string[];
  outputColumns: string[];
  outputRows: Row[];
  reviewItems: NewReviewItem[];
  decisionRecords: NewDecisionRecord[];
  stats: MetricRecord;
  primaryRowsWithoutAccount: number;
  eventsWithoutTimestamp: number;
  orphanEventAccounts: number;
}

export interface AccountFaultResult {
  outputColumns: string[];
  outputRows: Row[];
  reviewItems: NewReviewItem[];
  decisionRecords: NewDecisionRecord[];
  stats: MetricRecord;
}

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  no_events: 'No fault records found for this account',
  no_rule_match: 'Fault description did not match any rule',
  rule_conflict: 'Rules with equal priority produced conflicting values',
  low_confidence: 'Classification confidence is below the review threshold',
  ambiguous_latest_timestamp: 'Multiple faults share the latest timestamp',
  conflicting_fault_history: 'Earlier faults suggest a different root cause',
  unparsed_timestamp: 'Fault timestamps could not be parsed',
  duplicate_primary_key: 'Account appears more than once in the primary file',
  ai_low_confidence: 'AI suggestion confidence is below the review threshold',
  ai_ambiguous: 'AI reported ambiguity or missing information',
  ai_proposed_alternative: 'AI proposed a different classification than the matched rule',
  ai_failed: 'AI assistance was requested but failed',
};

export const REVIEW_REASON_SEVERITY: Record<ReviewReason, ReviewSeverity> = {
  no_events: 'warning',
  no_rule_match: 'warning',
  rule_conflict: 'warning',
  low_confidence: 'info',
  ambiguous_latest_timestamp: 'warning',
  conflicting_fault_history: 'warning',
  unparsed_timestamp: 'warning',
  duplicate_primary_key: 'critical',
  ai_low_confidence: 'info',
  ai_ambiguous: 'warning',
  ai_proposed_alternative: 'warning',
  ai_failed: 'warning',
};

export const REVIEW_REASON_ORDER: ReviewReason[] = [
  'duplicate_primary_key',
  'no_events',
  'no_rule_match',
  'rule_conflict',
  'unparsed_timestamp',
  'ambiguous_latest_timestamp',
  'conflicting_fault_history',
  'ai_proposed_alternative',
  'ai_ambiguous',
  'ai_low_confidence',
  'ai_failed',
  'low_confidence',
];
