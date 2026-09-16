import { z } from 'zod';

export const ruleOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches_regex',
  'in',
  'not_in',
  'is_empty',
  'is_not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
]);
export type RuleOperator = z.infer<typeof ruleOperatorSchema>;

export const scalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ScalarValue = z.infer<typeof scalarValueSchema>;

/**
 * Where a condition is evaluated.
 *
 * - `latest` (default): the field is read from the current/derived record (for the account-faults
 *   workflow this is the latest fault combined with account-level fields).
 * - `any_event`: the condition passes when at least one entry of the entity's event history matches.
 * - `all_events`: the condition passes when the entity has at least one event and every event matches.
 */
export const ruleConditionScopeSchema = z.enum(['latest', 'any_event', 'all_events']);
export type RuleConditionScope = z.infer<typeof ruleConditionScopeSchema>;

export const RULE_CONDITION_SCOPE_LABELS: Record<RuleConditionScope, string> = {
  latest: 'latest record',
  any_event: 'any record in history',
  all_events: 'every record in history',
};

export const ruleConditionSchema = z.object({
  field: z.string().min(1),
  operator: ruleOperatorSchema,
  value: z.union([scalarValueSchema, z.array(z.string())]).default(null),
  caseSensitive: z.boolean().default(false),
  scope: ruleConditionScopeSchema.default('latest'),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export interface ConditionGroup {
  mode: 'all' | 'any';
  conditions: ConditionNode[];
}

export type ConditionNode = RuleCondition | ConditionGroup;

export const conditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([ruleConditionSchema, conditionGroupSchema]),
);

export const conditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.object({
    mode: z.enum(['all', 'any']).default('all'),
    conditions: z.array(conditionNodeSchema).min(1),
  }),
);

export const ruleActionSchema = z.object({
  type: z.enum(['set', 'set_if_empty']).default('set'),
  field: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(0),
  when: conditionNodeSchema,
  then: z.array(ruleActionSchema).min(1),
  confidence: z.number().min(0).max(1).default(1),
  explanationTemplate: z.string().default(''),
  tags: z.array(z.string()).default([]),
});
export type Rule = z.infer<typeof ruleSchema>;

export const ruleSetSchema = z.object({
  slug: z.string().min(1),
  workflowSlug: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  active: z.boolean().default(true),
  rules: z.array(ruleSchema),
});
export type RuleSet = z.infer<typeof ruleSetSchema>;

export const storedRuleSetSchema = ruleSetSchema.extend({
  id: z.string().min(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type StoredRuleSet = z.infer<typeof storedRuleSetSchema>;

export const ruleDecisionStatusSchema = z.enum(['matched', 'no_match']);
export type RuleDecisionStatus = z.infer<typeof ruleDecisionStatusSchema>;

/** Why a deterministic decision still needs a human: no rule matched, rules disagreed, or low confidence. */
export const ruleReviewReasonSchema = z.enum(['no_rule_match', 'rule_conflict', 'low_confidence']);
export type RuleReviewReason = z.infer<typeof ruleReviewReasonSchema>;

export const evaluatedConditionSchema = z.object({
  field: z.string(),
  operator: ruleOperatorSchema,
  scope: ruleConditionScopeSchema,
  expected: z.unknown(),
  actual: z.unknown(),
  matched: z.boolean(),
});
export type EvaluatedCondition = z.infer<typeof evaluatedConditionSchema>;

export const ruleMatchSummarySchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  priority: z.number().int(),
  specificity: z.number().int().nonnegative(),
  matchedTerm: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type RuleMatchSummary = z.infer<typeof ruleMatchSummarySchema>;

export const ruleConflictSchema = z.object({
  ruleIds: z.array(z.string()),
  field: z.string(),
  values: z.array(z.string()),
  reason: z.string(),
});
export type RuleConflict = z.infer<typeof ruleConflictSchema>;

export const ruleEvaluationSchema = z.object({
  matchedRuleIds: z.array(z.string()),
  winnerRuleId: z.string().nullable(),
  winnerPriority: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
  status: ruleDecisionStatusSchema,
  needsReview: z.boolean(),
  reviewReasons: z.array(ruleReviewReasonSchema),
  explanation: z.string(),
  conflicts: z.array(ruleConflictSchema),
  conditions: z.array(evaluatedConditionSchema),
  resultingValues: z.record(z.string(), scalarValueSchema),
  matchedRules: z.array(ruleMatchSummarySchema),
  evaluatedRuleCount: z.number().int().nonnegative(),
});
export type RuleEvaluation = z.infer<typeof ruleEvaluationSchema>;

export const ruleValidationIssueSchema = z.object({
  level: z.enum(['error', 'warning']),
  message: z.string(),
  ruleId: z.string().optional(),
});
export type RuleValidationIssue = z.infer<typeof ruleValidationIssueSchema>;
