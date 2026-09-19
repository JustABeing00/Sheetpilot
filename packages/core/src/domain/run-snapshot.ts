import { z } from 'zod';
import { storedRuleSetSchema } from './rules.js';
import { workflowConfigurationSchema } from './workflow-config.js';

export const runSnapshotIdSchema = z.string().min(1);
export type RunSnapshotId = z.infer<typeof runSnapshotIdSchema>;

/**
 * An immutable, point-in-time capture of everything that can change the outcome of a run: the exact
 * workflow-configuration version (mappings + options) and the exact rule-set version that were in force
 * when the run was created.
 *
 * Runs reference rules and configurations by mutable identity, so without a snapshot, editing a mapping
 * or a rule tomorrow would silently change what yesterday's run "would have" produced. The snapshot is
 * written once, never updated, and is what makes historical runs reproducible and auditable.
 */
export const runSnapshotSchema = z.object({
  id: runSnapshotIdSchema,
  tenantId: z.string().min(1).nullable().default(null),
  runId: z.string().min(1),
  workflowSlug: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  configurationId: z.string().min(1).nullable().default(null),
  configuration: workflowConfigurationSchema.nullable().default(null),
  ruleSetId: z.string().min(1).nullable().default(null),
  ruleSet: storedRuleSetSchema.nullable().default(null),
  capturedAt: z.date(),
});
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

/**
 * The compact, human-facing view of a snapshot attached to every run DTO. It carries the version
 * numbers and names, not the full frozen payload (that is available from the dedicated endpoint).
 */
export const runSnapshotSummarySchema = z.object({
  runId: z.string().min(1),
  workflowSlug: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  configurationId: z.string().nullable(),
  configurationVersion: z.number().int().positive().nullable(),
  configurationName: z.string().nullable(),
  ruleSetId: z.string().nullable(),
  ruleSetVersion: z.number().int().positive().nullable(),
  ruleSetName: z.string().nullable(),
  ruleCount: z.number().int().nonnegative(),
  capturedAt: z.date(),
});
export type RunSnapshotSummary = z.infer<typeof runSnapshotSummarySchema>;

export function toRunSnapshotSummary(snapshot: RunSnapshot): RunSnapshotSummary {
  return {
    runId: snapshot.runId,
    workflowSlug: snapshot.workflowSlug,
    workflowVersion: snapshot.workflowVersion,
    configurationId: snapshot.configurationId,
    configurationVersion: snapshot.configuration?.version ?? null,
    configurationName: snapshot.configuration?.name ?? null,
    ruleSetId: snapshot.ruleSetId,
    ruleSetVersion: snapshot.ruleSet?.version ?? null,
    ruleSetName: snapshot.ruleSet?.name ?? null,
    ruleCount: snapshot.ruleSet?.rules.length ?? 0,
    capturedAt: snapshot.capturedAt,
  };
}
