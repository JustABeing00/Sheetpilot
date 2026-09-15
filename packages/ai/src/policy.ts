import type { AiPolicy, RuleEvaluation } from '@sheetpilot/core';

export type AiDecisionReason =
  'policy_never' | 'policy_always' | 'no_rule_match' | 'low_confidence' | 'rules_sufficient';

export interface AiDecision {
  shouldConsult: boolean;
  reason: AiDecisionReason;
}

export interface AiDecisionInput {
  ruleEvaluation: RuleEvaluation;
  confidenceThreshold: number;
}

export function decideAiUsage(policy: AiPolicy, input: AiDecisionInput): AiDecision {
  switch (policy) {
    case 'never':
      return { shouldConsult: false, reason: 'policy_never' };
    case 'always':
      return { shouldConsult: true, reason: 'policy_always' };
    case 'on_no_rule_match':
      return input.ruleEvaluation.winnerRuleId === null
        ? { shouldConsult: true, reason: 'no_rule_match' }
        : { shouldConsult: false, reason: 'rules_sufficient' };
    case 'on_low_confidence':
      return input.ruleEvaluation.confidence < input.confidenceThreshold
        ? { shouldConsult: true, reason: 'low_confidence' }
        : { shouldConsult: false, reason: 'rules_sufficient' };
  }
}
