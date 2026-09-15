import { z } from 'zod';

export const runStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const stepStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const reviewItemStatusSchema = z.enum([
  'open',
  'resolved_accepted',
  'resolved_overridden',
  'dismissed',
]);
export type ReviewItemStatus = z.infer<typeof reviewItemStatusSchema>;

export const reviewActionSchema = z.enum(['accepted', 'overridden', 'dismissed']);
export type ReviewAction = z.infer<typeof reviewActionSchema>;

export const reviewSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;

export const reviewReasonSchema = z.enum([
  'no_events',
  'no_rule_match',
  'rule_conflict',
  'low_confidence',
  'ambiguous_latest_timestamp',
  'conflicting_fault_history',
  'unparsed_timestamp',
  'duplicate_primary_key',
]);
export type ReviewReason = z.infer<typeof reviewReasonSchema>;

export const fileKindSchema = z.enum(['primary', 'events', 'generic']);
export type FileKind = z.infer<typeof fileKindSchema>;

export const tabularFormatSchema = z.enum(['csv', 'xlsx']);
export type TabularFormat = z.infer<typeof tabularFormatSchema>;

export const artifactKindSchema = z.enum(['output_csv', 'output_xlsx', 'review_queue_csv']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const aiPolicySchema = z.enum(['never', 'on_no_rule_match', 'on_low_confidence', 'always']);
export type AiPolicy = z.infer<typeof aiPolicySchema>;

export const aiProviderIdSchema = z.enum(['noop', 'openai']);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;
