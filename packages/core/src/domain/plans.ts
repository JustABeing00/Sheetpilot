import { z } from 'zod';

/** Commercial plans. New workspaces start on `free`; billing may move a tenant to another plan. */
export const planIdSchema = z.enum(['free', 'pro', 'enterprise']);
export type PlanId = z.infer<typeof planIdSchema>;

/** `null` means the plan places no limit on that metric. */
export const planLimitsSchema = z.object({
  maxMembers: z.number().int().positive().nullable(),
  maxDatasets: z.number().int().positive().nullable(),
  maxRunsPerMonth: z.number().int().positive().nullable(),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  limits: PlanLimits;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    limits: { maxMembers: 3, maxDatasets: 25, maxRunsPerMonth: 100 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    limits: { maxMembers: 25, maxDatasets: 500, maxRunsPerMonth: 5_000 },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    limits: { maxMembers: null, maxDatasets: null, maxRunsPerMonth: null },
  },
};

export function planDefinition(plan: PlanId): PlanDefinition {
  return PLANS[plan];
}

/** The first instant of the UTC calendar month containing `now`: the metering period boundary. */
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
