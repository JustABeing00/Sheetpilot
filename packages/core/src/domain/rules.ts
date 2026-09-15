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

export const ruleConditionSchema = z.object({
  field: z.string().min(1),
  operator: ruleOperatorSchema,
  value: z.union([scalarValueSchema, z.array(z.string())]).default(null),
  caseSensitive: z.boolean().default(false),
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

export const ruleEvaluationSchema = z.object({
  matchedRuleIds: z.array(z.string()),
  winnerRuleId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  conflicts: z.array(
    z.object({
      ruleIds: z.array(z.string()),
      field: z.string(),
      reason: z.string(),
    }),
  ),
  evaluatedRuleCount: z.number().int().nonnegative(),
});
export type RuleEvaluation = z.infer<typeof ruleEvaluationSchema>;
