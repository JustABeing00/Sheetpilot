import { and, asc, count, desc, eq } from 'drizzle-orm';
import {
  artifactSchema,
  decisionRecordSchema,
  fileAssetSchema,
  reviewItemSchema,
  storedRuleSetSchema,
  stepRunSchema,
  workflowRunSchema,
  workflowSchema,
  type Artifact,
  type DecisionRecord,
  type FileAsset,
  type Repositories,
  type ReviewItem,
  type StepRun,
  type StoredRuleSet,
  type Workflow,
  type WorkflowRun,
} from '@sheetpilot/core';
import type { Database } from '../../client.js';
import {
  artifacts,
  files,
  reviewItems,
  ruleSets,
  runDecisions,
  runs,
  runSteps,
  workflows,
} from '../../schema/tables.js';

const toFileAsset = (row: typeof files.$inferSelect): FileAsset => fileAssetSchema.parse(row);
const toWorkflow = (row: typeof workflows.$inferSelect): Workflow => workflowSchema.parse(row);
const toRun = (row: typeof runs.$inferSelect): WorkflowRun => workflowRunSchema.parse(row);
const toStepRun = (row: typeof runSteps.$inferSelect): StepRun =>
  stepRunSchema.parse({ ...row, order: row.stepOrder });
const toDecision = (row: typeof runDecisions.$inferSelect): DecisionRecord =>
  decisionRecordSchema.parse(row);
const toReviewItem = (row: typeof reviewItems.$inferSelect): ReviewItem =>
  reviewItemSchema.parse({ ...row, resolution: row.resolution ?? null });
const toArtifact = (row: typeof artifacts.$inferSelect): Artifact => artifactSchema.parse(row);
const toRuleSet = (row: typeof ruleSets.$inferSelect): StoredRuleSet =>
  storedRuleSetSchema.parse(row);

export function createPostgresRepositories(db: Database): Repositories {
  return {
    files: {
      async create(asset) {
        const [row] = await db.insert(files).values(asset).returning();
        return toFileAsset(row!);
      },
      async getById(id) {
        const [row] = await db.select().from(files).where(eq(files.id, id)).limit(1);
        return row ? toFileAsset(row) : null;
      },
      async list(limit) {
        const query = db.select().from(files).orderBy(desc(files.uploadedAt));
        const rows = limit === undefined ? await query : await query.limit(limit);
        return rows.map(toFileAsset);
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
          .where(options?.status ? eq(runs.status, options.status) : undefined)
          .orderBy(desc(runs.createdAt))
          .limit(options?.limit ?? 50)
          .offset(options?.offset ?? 0);
        return rows.map(toRun);
      },
      async count() {
        const [row] = await db.select({ value: count() }).from(runs);
        return row?.value ?? 0;
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
    },

    decisions: {
      async createMany(records) {
        if (records.length === 0) {
          return;
        }
        await db.insert(runDecisions).values(
          records.map((record) => ({
            id: record.id,
            runId: record.runId,
            entityKey: record.entityKey,
            matchedRuleIds: record.matchedRuleIds,
            aiAssisted: record.aiAssisted,
            confidence: record.confidence,
            reviewReasons: record.reviewReasons,
            outputValues: record.outputValues,
            evidence: record.evidence,
            createdAt: record.createdAt,
          })),
        );
      },
      async listByRun(runId, options) {
        const rows = await db
          .select()
          .from(runDecisions)
          .where(eq(runDecisions.runId, runId))
          .orderBy(asc(runDecisions.entityKey))
          .limit(options?.limit ?? 100)
          .offset(options?.offset ?? 0);
        return rows.map(toDecision);
      },
      async countByRun(runId) {
        const [row] = await db
          .select({ value: count() })
          .from(runDecisions)
          .where(eq(runDecisions.runId, runId));
        return row?.value ?? 0;
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
        const rows = await db
          .select()
          .from(reviewItems)
          .where(
            options?.status
              ? and(eq(reviewItems.runId, runId), eq(reviewItems.status, options.status))
              : eq(reviewItems.runId, runId),
          )
          .orderBy(desc(reviewItems.createdAt))
          .limit(options?.limit ?? 100)
          .offset(options?.offset ?? 0);
        return rows.map(toReviewItem);
      },
      async list(options) {
        const rows = await db
          .select()
          .from(reviewItems)
          .where(options?.status ? eq(reviewItems.status, options.status) : undefined)
          .orderBy(desc(reviewItems.createdAt))
          .limit(options?.limit ?? 100)
          .offset(options?.offset ?? 0);
        return rows.map(toReviewItem);
      },
      async countOpen() {
        const [row] = await db
          .select({ value: count() })
          .from(reviewItems)
          .where(eq(reviewItems.status, 'open'));
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
    },

    artifacts: {
      async create(artifact) {
        const [row] = await db.insert(artifacts).values(artifact).returning();
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
      async getActiveByWorkflowSlug(workflowSlug) {
        const [row] = await db
          .select()
          .from(ruleSets)
          .where(and(eq(ruleSets.workflowSlug, workflowSlug), eq(ruleSets.active, true)))
          .limit(1);
        return row ? toRuleSet(row) : null;
      },
      async list() {
        const rows = await db.select().from(ruleSets).orderBy(asc(ruleSets.slug));
        return rows.map(toRuleSet);
      },
    },
  };
}
