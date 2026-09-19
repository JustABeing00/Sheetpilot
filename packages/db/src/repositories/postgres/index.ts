import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import {
  artifactSchema,
  datasetProfileSchema,
  decisionRecordSchema,
  fileAssetSchema,
  invitationSchema,
  membershipSchema,
  reviewItemSchema,
  reviewResolutionLogSchema,
  runSnapshotSchema,
  storedRuleSetSchema,
  stepRunSchema,
  tenantSchema,
  workflowConfigurationSchema,
  workflowRunSchema,
  workflowSchema,
  type Artifact,
  type DatasetProfile,
  type DecisionRecord,
  type FileAsset,
  type Membership,
  type MembershipRole,
  type Repositories,
  type Tenant,
  type ReviewCounts,
  type ReviewItem,
  type ReviewListOptions,
  type ReviewResolutionLog,
  type RunSnapshot,
  type StepRun,
  type StoredRuleSet,
  type Workflow,
  type WorkflowConfiguration,
  type WorkflowRun,
} from '@sheetpilot/core';
import type { SQL } from 'drizzle-orm';
import type { Database } from '../../client.js';
import {
  artifacts,
  datasets,
  files,
  invitations,
  memberships,
  reviewItems,
  reviewResolutions,
  ruleSets,
  runDecisions,
  runs,
  runSnapshots,
  runSteps,
  tenants,
  users,
  workflowConfigurations,
  workflows,
} from '../../schema/tables.js';

const CONFLICT_REASONS = [
  'rule_conflict',
  'conflicting_fault_history',
  'ambiguous_latest_timestamp',
];
const LOW_CONFIDENCE_REASONS = ['low_confidence', 'ai_low_confidence'];

function reviewCondition(options?: ReviewListOptions, runId?: string): SQL | undefined {
  const conditions: SQL[] = [];
  const scope = runId ?? options?.runId;
  if (scope) {
    conditions.push(eq(reviewItems.runId, scope));
  }
  if (options?.tenantId != null) {
    conditions.push(eq(reviewItems.tenantId, options.tenantId));
  }
  if (options?.statuses && options.statuses.length > 0) {
    conditions.push(inArray(reviewItems.status, options.statuses));
  } else if (options?.status) {
    conditions.push(eq(reviewItems.status, options.status));
  }
  if (options?.reasons && options.reasons.length > 0) {
    conditions.push(inArray(reviewItems.reason, options.reasons));
  }
  if (options?.severities && options.severities.length > 0) {
    conditions.push(inArray(reviewItems.severity, options.severities));
  }
  return conditions.length === 0 ? undefined : and(...conditions);
}

const toFileAsset = (row: typeof files.$inferSelect): FileAsset => fileAssetSchema.parse(row);
const toDataset = (row: typeof datasets.$inferSelect): DatasetProfile =>
  datasetProfileSchema.parse(row);
const toWorkflowConfiguration = (
  row: typeof workflowConfigurations.$inferSelect,
): WorkflowConfiguration => workflowConfigurationSchema.parse(row);
const toWorkflow = (row: typeof workflows.$inferSelect): Workflow => workflowSchema.parse(row);
const toRun = (row: typeof runs.$inferSelect): WorkflowRun => workflowRunSchema.parse(row);
const toStepRun = (row: typeof runSteps.$inferSelect): StepRun =>
  stepRunSchema.parse({ ...row, order: row.stepOrder });
const toDecision = (row: typeof runDecisions.$inferSelect): DecisionRecord =>
  decisionRecordSchema.parse(row);
const toReviewItem = (row: typeof reviewItems.$inferSelect): ReviewItem =>
  reviewItemSchema.parse({ ...row, resolution: row.resolution ?? null });
const toReviewResolution = (row: typeof reviewResolutions.$inferSelect): ReviewResolutionLog =>
  reviewResolutionLogSchema.parse(row);
const toArtifact = (row: typeof artifacts.$inferSelect): Artifact => artifactSchema.parse(row);
const toRuleSet = (row: typeof ruleSets.$inferSelect): StoredRuleSet =>
  storedRuleSetSchema.parse(row);
const toTenant = (row: typeof tenants.$inferSelect): Tenant => tenantSchema.parse(row);
const toMembership = (row: typeof memberships.$inferSelect): Membership =>
  membershipSchema.parse(row);

/**
 * The frozen configuration/rule-set payloads are stored as JSON, so their embedded `createdAt`/
 * `updatedAt` timestamps come back as ISO strings. Revive them before the domain schema (which expects
 * `Date`) validates the snapshot.
 */
function reviveEmbeddedDates(
  record: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!record) {
    return null;
  }
  const { createdAt, updatedAt, ...rest } = record;
  return {
    ...rest,
    ...(createdAt !== undefined ? { createdAt: new Date(createdAt as string) } : {}),
    ...(updatedAt !== undefined ? { updatedAt: new Date(updatedAt as string) } : {}),
  };
}

const toRunSnapshot = (row: typeof runSnapshots.$inferSelect): RunSnapshot =>
  runSnapshotSchema.parse({
    ...row,
    configuration: reviveEmbeddedDates(row.configuration),
    ruleSet: reviveEmbeddedDates(row.ruleSet),
  });

export function createPostgresRepositories(db: Database): Repositories {
  return {
    users: {
      async getById(id) {
        const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        return row ? { id: row.id, name: row.name, email: row.email, image: row.image } : null;
      },
      async getByEmail(email) {
        const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        return row ? { id: row.id, name: row.name, email: row.email, image: row.image } : null;
      },
      async listByIds(ids) {
        if (ids.length === 0) {
          return [];
        }
        const rows = await db.select().from(users).where(inArray(users.id, ids));
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          image: row.image,
        }));
      },
    },

    invitations: {
      async create(invitation) {
        const [row] = await db.insert(invitations).values(invitation).returning();
        return invitationSchema.parse(row!);
      },
      async getById(id) {
        const [row] = await db.select().from(invitations).where(eq(invitations.id, id)).limit(1);
        return row ? invitationSchema.parse(row) : null;
      },
      async listByTenant(tenantId) {
        const rows = await db
          .select()
          .from(invitations)
          .where(eq(invitations.tenantId, tenantId))
          .orderBy(desc(invitations.createdAt));
        return rows.map((row) => invitationSchema.parse(row));
      },
      async listByEmail(email) {
        const rows = await db.select().from(invitations).where(eq(invitations.email, email));
        return rows.map((row) => invitationSchema.parse(row));
      },
      async delete(id) {
        await db.delete(invitations).where(eq(invitations.id, id));
      },
    },

    tenants: {
      async create(tenant) {
        const [row] = await db.insert(tenants).values(tenant).returning();
        return toTenant(row!);
      },
      async update(tenant) {
        const [row] = await db
          .update(tenants)
          .set({ name: tenant.name, slug: tenant.slug, updatedAt: tenant.updatedAt })
          .where(eq(tenants.id, tenant.id))
          .returning();
        return toTenant(row!);
      },
      async getById(id) {
        const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
        return row ? toTenant(row) : null;
      },
      async getBySlug(slug) {
        const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
        return row ? toTenant(row) : null;
      },
      async listForUser(userId) {
        const rows = await db
          .select({ tenant: tenants })
          .from(memberships)
          .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
          .where(eq(memberships.userId, userId))
          .orderBy(desc(memberships.createdAt));
        return rows.map((row) => toTenant(row.tenant));
      },
      async count() {
        const [row] = await db.select({ value: count() }).from(tenants);
        return row?.value ?? 0;
      },
    },

    memberships: {
      async create(membership) {
        const [row] = await db.insert(memberships).values(membership).returning();
        return toMembership(row!);
      },
      async update(membership) {
        const [row] = await db
          .update(memberships)
          .set({ role: membership.role, updatedAt: membership.updatedAt })
          .where(eq(memberships.id, membership.id))
          .returning();
        return toMembership(row!);
      },
      async delete(id) {
        await db.delete(memberships).where(eq(memberships.id, id));
      },
      async getForUserAndTenant(userId, tenantId) {
        const [row] = await db
          .select()
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
          .limit(1);
        return row ? toMembership(row) : null;
      },
      async listForUser(userId) {
        const rows = await db.select().from(memberships).where(eq(memberships.userId, userId));
        return rows.map(toMembership);
      },
      async listForTenant(tenantId) {
        const rows = await db
          .select()
          .from(memberships)
          .where(eq(memberships.tenantId, tenantId))
          .orderBy(asc(memberships.createdAt));
        return rows.map(toMembership);
      },
      async countForTenant(tenantId) {
        const [row] = await db
          .select({ value: count() })
          .from(memberships)
          .where(eq(memberships.tenantId, tenantId));
        return row?.value ?? 0;
      },
      async getDefaultForUser(userId) {
        const [row] = await db
          .select()
          .from(memberships)
          .where(eq(memberships.userId, userId))
          .orderBy(asc(memberships.createdAt))
          .limit(1);
        return row ? toMembership(row) : null;
      },
      async setRole(id, role: MembershipRole, updatedAt) {
        const [row] = await db
          .update(memberships)
          .set({ role, updatedAt })
          .where(eq(memberships.id, id))
          .returning();
        return toMembership(row!);
      },
    },

    files: {
      async create(asset) {
        const [row] = await db.insert(files).values(asset).returning();
        return toFileAsset(row!);
      },
      async getById(id) {
        const [row] = await db.select().from(files).where(eq(files.id, id)).limit(1);
        return row ? toFileAsset(row) : null;
      },
      async list(options) {
        const query = db
          .select()
          .from(files)
          .where(options?.tenantId != null ? eq(files.tenantId, options.tenantId) : undefined)
          .orderBy(desc(files.uploadedAt));
        const rows = options?.limit === undefined ? await query : await query.limit(options.limit);
        return rows.map(toFileAsset);
      },
      async delete(id) {
        await db.delete(files).where(eq(files.id, id));
      },
    },

    datasets: {
      async create(dataset) {
        const [row] = await db.insert(datasets).values(dataset).returning();
        return toDataset(row!);
      },
      async getById(id) {
        const [row] = await db.select().from(datasets).where(eq(datasets.id, id)).limit(1);
        return row ? toDataset(row) : null;
      },
      async list(options) {
        const rows = await db
          .select()
          .from(datasets)
          .where(options?.tenantId != null ? eq(datasets.tenantId, options.tenantId) : undefined)
          .orderBy(desc(datasets.inspectedAt))
          .limit(options?.limit ?? 100)
          .offset(options?.offset ?? 0);
        return rows.map(toDataset);
      },
      async delete(id) {
        await db.delete(datasets).where(eq(datasets.id, id));
      },
    },

    workflowConfigurations: {
      async create(configuration) {
        const [row] = await db.insert(workflowConfigurations).values(configuration).returning();
        return toWorkflowConfiguration(row!);
      },
      async update(configuration) {
        const [row] = await db
          .update(workflowConfigurations)
          .set({
            name: configuration.name,
            description: configuration.description,
            version: configuration.version,
            assignments: configuration.assignments,
            mappings: configuration.mappings,
            options: configuration.options,
            updatedAt: configuration.updatedAt,
          })
          .where(eq(workflowConfigurations.id, configuration.id))
          .returning();
        return toWorkflowConfiguration(row!);
      },
      async getById(id) {
        const [row] = await db
          .select()
          .from(workflowConfigurations)
          .where(eq(workflowConfigurations.id, id))
          .limit(1);
        return row ? toWorkflowConfiguration(row) : null;
      },
      async list(options) {
        const rows = await db
          .select()
          .from(workflowConfigurations)
          .where(
            and(
              options?.workflowSlug
                ? eq(workflowConfigurations.workflowSlug, options.workflowSlug)
                : undefined,
              options?.tenantId != null
                ? eq(workflowConfigurations.tenantId, options.tenantId)
                : undefined,
            ),
          )
          .orderBy(desc(workflowConfigurations.updatedAt))
          .limit(options?.limit ?? 100)
          .offset(options?.offset ?? 0);
        return rows.map(toWorkflowConfiguration);
      },
      async delete(id) {
        await db.delete(workflowConfigurations).where(eq(workflowConfigurations.id, id));
      },
    },

    workflows: {
      async upsert(workflow) {
        const [row] = await db
          .insert(workflows)
          .values(workflow)
          .onConflictDoUpdate({ target: workflows.id, set: { ...workflow } })
          .returning();
        return toWorkflow(row!);
      },
      async getById(id) {
        const [row] = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
        return row ? toWorkflow(row) : null;
      },
      async getBySlug(slug) {
        const [row] = await db.select().from(workflows).where(eq(workflows.slug, slug)).limit(1);
        return row ? toWorkflow(row) : null;
      },
      async list() {
        const rows = await db.select().from(workflows).orderBy(asc(workflows.name));
        return rows.map(toWorkflow);
      },
    },

    runs: {
      async create(run) {
        const [row] = await db.insert(runs).values(run).returning();
        return toRun(row!);
      },
      async update(run) {
        const [row] = await db
          .update(runs)
          .set({
            status: run.status,
            stats: run.stats,
            error: run.error,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
          })
          .where(eq(runs.id, run.id))
          .returning();
        return toRun(row!);
      },
      async getById(id) {
        const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
        return row ? toRun(row) : null;
      },
      async list(options) {
        const rows = await db
          .select()
          .from(runs)
          .where(
            and(
              options?.status ? eq(runs.status, options.status) : undefined,
              options?.tenantId != null ? eq(runs.tenantId, options.tenantId) : undefined,
            ),
          )
          .orderBy(desc(runs.createdAt))
          .limit(options?.limit ?? 50)
          .offset(options?.offset ?? 0);
        return rows.map(toRun);
      },
      async count() {
        const [row] = await db.select({ value: count() }).from(runs);
        return row?.value ?? 0;
      },
      async delete(id) {
        await db.delete(runs).where(eq(runs.id, id));
      },
    },

    runSnapshots: {
      async create(snapshot) {
        const [row] = await db
          .insert(runSnapshots)
          .values({
            id: snapshot.id,
            tenantId: snapshot.tenantId,
            runId: snapshot.runId,
            workflowSlug: snapshot.workflowSlug,
            workflowVersion: snapshot.workflowVersion,
            configurationId: snapshot.configurationId,
            configuration: snapshot.configuration,
            ruleSetId: snapshot.ruleSetId,
            ruleSet: snapshot.ruleSet,
            capturedAt: snapshot.capturedAt,
          })
          .returning();
        return toRunSnapshot(row!);
      },
      async getByRunId(runId) {
        const [row] = await db
          .select()
          .from(runSnapshots)
          .where(eq(runSnapshots.runId, runId))
          .limit(1);
        return row ? toRunSnapshot(row) : null;
      },
      async deleteByRun(runId) {
        await db.delete(runSnapshots).where(eq(runSnapshots.runId, runId));
      },
    },

    steps: {
      async createMany(records) {
        if (records.length === 0) {
          return;
        }
        await db.insert(runSteps).values(
          records.map((record) => ({
            id: record.id,
            tenantId: record.tenantId,
            runId: record.runId,
            stepId: record.stepId,
            name: record.name,
            stepOrder: record.order,
            status: record.status,
            startedAt: record.startedAt,
            finishedAt: record.finishedAt,
            durationMs: record.durationMs,
            metrics: record.metrics,
            error: record.error,
          })),
        );
      },
      async update(step) {
        const [row] = await db
          .update(runSteps)
          .set({
            status: step.status,
            startedAt: step.startedAt,
            finishedAt: step.finishedAt,
            durationMs: step.durationMs,
            metrics: step.metrics,
            error: step.error,
          })
          .where(eq(runSteps.id, step.id))
          .returning();
        return toStepRun(row!);
      },
      async listByRun(runId) {
        const rows = await db
          .select()
          .from(runSteps)
          .where(eq(runSteps.runId, runId))
          .orderBy(asc(runSteps.stepOrder));
        return rows.map(toStepRun);
      },
      async deleteByRun(runId) {
        await db.delete(runSteps).where(eq(runSteps.runId, runId));
      },
    },

    decisions: {
      async createMany(records) {
        if (records.length === 0) {
          return;
        }
        await db.insert(runDecisions).values(
          records.map((record) => ({
            id: record.id,
            tenantId: record.tenantId,
            runId: record.runId,
            entityKey: record.entityKey,
            matchedRuleIds: record.matchedRuleIds,
            aiAssisted: record.aiAssisted,
            decisionSource: record.decisionSource,
            confidence: record.confidence,
            reviewReasons: record.reviewReasons,
            outputValues: record.outputValues,
            evidence: record.evidence,
            createdAt: record.createdAt,
          })),
        );
      },
      async listByRun(runId, options) {
        // No limit means "all decisions for this run" (the in-memory driver's behaviour). The default
        // 100-row cap here used to silently truncate the export summary and the review lookup.
        const base = db
          .select()
          .from(runDecisions)
          .where(eq(runDecisions.runId, runId))
          .orderBy(asc(runDecisions.entityKey));
        const rows =
          options?.limit === undefined
            ? await base.offset(options?.offset ?? 0)
            : await base.limit(options.limit).offset(options?.offset ?? 0);
        return rows.map(toDecision);
      },
      async countByRun(runId) {
        const [row] = await db
          .select({ value: count() })
          .from(runDecisions)
          .where(eq(runDecisions.runId, runId));
        return row?.value ?? 0;
      },
      async deleteByRun(runId) {
        await db.delete(runDecisions).where(eq(runDecisions.runId, runId));
      },
    },

    reviewItems: {
      async createMany(items) {
        if (items.length === 0) {
          return;
        }
        await db.insert(reviewItems).values(
          items.map((item) => ({
            id: item.id,
            tenantId: item.tenantId,
            runId: item.runId,
            entityKey: item.entityKey,
            reason: item.reason,
            severity: item.severity,
            status: item.status,
            title: item.title,
            detail: item.detail,
            suggestedValues: item.suggestedValues,
            evidence: item.evidence,
            resolution: item.resolution,
            createdAt: item.createdAt,
            resolvedAt: item.resolvedAt,
          })),
        );
      },
      async getById(id) {
        const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id)).limit(1);
        return row ? toReviewItem(row) : null;
      },
      async update(item) {
        const [row] = await db
          .update(reviewItems)
          .set({
            status: item.status,
            resolution: item.resolution,
            resolvedAt: item.resolvedAt,
          })
          .where(eq(reviewItems.id, item.id))
          .returning();
        return toReviewItem(row!);
      },
      async listByRun(runId, options) {
        // No limit means "all review items for this run" (matching the in-memory driver); a default
        // cap here truncated the derived export status and the run's review list.
        const base = db
          .select()
          .from(reviewItems)
          .where(reviewCondition(options, runId))
          .orderBy(desc(reviewItems.createdAt));
        const rows =
          options?.limit === undefined
            ? await base.offset(options?.offset ?? 0)
            : await base.limit(options.limit).offset(options?.offset ?? 0);
        return rows.map(toReviewItem);
      },
      async list(options) {
        const base = db
          .select()
          .from(reviewItems)
          .where(reviewCondition(options))
          .orderBy(desc(reviewItems.createdAt));
        const rows =
          options?.limit === undefined
            ? await base.offset(options?.offset ?? 0)
            : await base.limit(options.limit).offset(options?.offset ?? 0);
        return rows.map(toReviewItem);
      },
      async countOpen(tenantId) {
        const [row] = await db
          .select({ value: count() })
          .from(reviewItems)
          .where(
            and(
              eq(reviewItems.status, 'open'),
              tenantId != null ? eq(reviewItems.tenantId, tenantId) : undefined,
            ),
          );
        return row?.value ?? 0;
      },
      async countByRun(runId) {
        const [row] = await db
          .select({ value: count() })
          .from(reviewItems)
          .where(eq(reviewItems.runId, runId));
        return row?.value ?? 0;
      },
      async countOpenByRun(runId) {
        const [row] = await db
          .select({ value: count() })
          .from(reviewItems)
          .where(and(eq(reviewItems.runId, runId), eq(reviewItems.status, 'open')));
        return row?.value ?? 0;
      },
      async counts(tenantId) {
        const rows = await db
          .select({ status: reviewItems.status, reason: reviewItems.reason })
          .from(reviewItems)
          .where(tenantId != null ? eq(reviewItems.tenantId, tenantId) : undefined);
        const result: ReviewCounts = {
          total: rows.length,
          open: 0,
          needsReview: 0,
          overridden: 0,
          conflicts: 0,
          lowConfidence: 0,
          processingErrors: 0,
        };
        for (const row of rows) {
          if (row.status === 'open') {
            result.open += 1;
            if (row.reason !== 'ai_failed') {
              result.needsReview += 1;
            }
          }
          if (row.status === 'resolved_overridden') {
            result.overridden += 1;
          }
          if (CONFLICT_REASONS.includes(row.reason)) {
            result.conflicts += 1;
          }
          if (LOW_CONFIDENCE_REASONS.includes(row.reason)) {
            result.lowConfidence += 1;
          }
          if (row.reason === 'ai_failed') {
            result.processingErrors += 1;
          }
        }
        return result;
      },
      async deleteByRun(runId) {
        await db.delete(reviewItems).where(eq(reviewItems.runId, runId));
      },
    },

    reviewResolutions: {
      async create(entry) {
        const [row] = await db
          .insert(reviewResolutions)
          .values({
            id: entry.id,
            tenantId: entry.tenantId,
            reviewItemId: entry.reviewItemId,
            runId: entry.runId,
            entityKey: entry.entityKey,
            action: entry.action,
            previousStatus: entry.previousStatus,
            resultingState: entry.resultingState,
            automation: entry.automation,
            suggestedValues: entry.suggestedValues,
            appliedValues: entry.appliedValues,
            changedFields: entry.changedFields,
            note: entry.note,
            resolvedBy: entry.resolvedBy,
            createdAt: entry.createdAt,
          })
          .returning();
        return toReviewResolution(row!);
      },
      async listByItem(reviewItemId) {
        const rows = await db
          .select()
          .from(reviewResolutions)
          .where(eq(reviewResolutions.reviewItemId, reviewItemId))
          .orderBy(desc(reviewResolutions.createdAt));
        return rows.map(toReviewResolution);
      },
      async listByRun(runId, options) {
        const rows = await db
          .select()
          .from(reviewResolutions)
          .where(eq(reviewResolutions.runId, runId))
          .orderBy(desc(reviewResolutions.createdAt))
          .limit(options?.limit ?? 200)
          .offset(options?.offset ?? 0);
        return rows.map(toReviewResolution);
      },
      async deleteByRun(runId) {
        await db.delete(reviewResolutions).where(eq(reviewResolutions.runId, runId));
      },
    },

    artifacts: {
      async create(artifact) {
        const [row] = await db.insert(artifacts).values(artifact).returning();
        return toArtifact(row!);
      },
      async update(artifact) {
        const [row] = await db
          .update(artifacts)
          .set({ sizeBytes: artifact.sizeBytes, createdAt: artifact.createdAt })
          .where(eq(artifacts.id, artifact.id))
          .returning();
        return toArtifact(row!);
      },
      async getById(id) {
        const [row] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
        return row ? toArtifact(row) : null;
      },
      async listByRun(runId) {
        const rows = await db
          .select()
          .from(artifacts)
          .where(eq(artifacts.runId, runId))
          .orderBy(asc(artifacts.createdAt));
        return rows.map(toArtifact);
      },
      async deleteByRun(runId) {
        await db.delete(artifacts).where(eq(artifacts.runId, runId));
      },
    },

    ruleSets: {
      async upsert(ruleSet) {
        const [row] = await db
          .insert(ruleSets)
          .values({ ...ruleSet, rules: ruleSet.rules })
          .onConflictDoUpdate({ target: ruleSets.id, set: { ...ruleSet, rules: ruleSet.rules } })
          .returning();
        return toRuleSet(row!);
      },
      async getById(id) {
        const [row] = await db.select().from(ruleSets).where(eq(ruleSets.id, id)).limit(1);
        return row ? toRuleSet(row) : null;
      },
      async getActiveByWorkflowSlug(workflowSlug, tenantId) {
        // Deterministic winner if two rows ever coexist as active: the most recently updated set.
        const [row] = await db
          .select()
          .from(ruleSets)
          .where(
            and(
              eq(ruleSets.workflowSlug, workflowSlug),
              eq(ruleSets.active, true),
              tenantId != null ? eq(ruleSets.tenantId, tenantId) : undefined,
            ),
          )
          .orderBy(desc(ruleSets.updatedAt))
          .limit(1);
        return row ? toRuleSet(row) : null;
      },
      async listByWorkflowSlug(workflowSlug, tenantId) {
        const rows = await db
          .select()
          .from(ruleSets)
          .where(
            and(
              eq(ruleSets.workflowSlug, workflowSlug),
              tenantId != null ? eq(ruleSets.tenantId, tenantId) : undefined,
            ),
          )
          .orderBy(desc(ruleSets.updatedAt));
        return rows.map(toRuleSet);
      },
      async list(tenantId) {
        const rows = await db
          .select()
          .from(ruleSets)
          .where(tenantId != null ? eq(ruleSets.tenantId, tenantId) : undefined)
          .orderBy(asc(ruleSets.slug));
        return rows.map(toRuleSet);
      },
      async delete(id) {
        await db.delete(ruleSets).where(eq(ruleSets.id, id));
      },
    },
  };
}
