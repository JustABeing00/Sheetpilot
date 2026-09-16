import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CapturingLogger,
  fileAssetSchema,
  fixedClock,
  ruleSetSchema,
  type FileAsset,
  type FileRepository,
} from '@sheetpilot/core';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { NoopClassificationProvider } from '@sheetpilot/ai';
import { createStepContext } from '../../engine.js';
import type { WorkflowOutputs } from '../../registry.js';
import type { WorkflowExecution } from '../../types.js';
import { createAccountFaultWorkflow } from './workflow.js';

const samplesDir = new URL('../../../../../samples/account-faults/', import.meta.url);
const PRIMARY_CSV = readFileSync(
  fileURLToPath(new URL('primary_accounts.csv', samplesDir)),
  'utf8',
);
const EVENTS_CSV = readFileSync(fileURLToPath(new URL('fault_events.csv', samplesDir)), 'utf8');

interface Harness {
  execution: WorkflowExecution<WorkflowOutputs>;
  storage: InMemoryFileStorage;
}

async function runWorkflow(input: Record<string, unknown> = {}): Promise<Harness> {
  const storage = new InMemoryFileStorage();
  await storage.put('uploads/primary.csv', PRIMARY_CSV);
  await storage.put('uploads/events.csv', EVENTS_CSV);

  const uploadedAt = new Date('2026-03-05T06:00:00Z');
  const assets: FileAsset[] = [
    fileAssetSchema.parse({
      id: 'file-primary',
      kind: 'primary',
      originalName: 'primary_accounts.csv',
      format: 'csv',
      mimeType: 'text/csv',
      sizeBytes: PRIMARY_CSV.length,
      checksum: 'primary-checksum',
      storageKey: 'uploads/primary.csv',
      uploadedAt,
    }),
    fileAssetSchema.parse({
      id: 'file-events',
      kind: 'events',
      originalName: 'fault_events.csv',
      format: 'csv',
      mimeType: 'text/csv',
      sizeBytes: EVENTS_CSV.length,
      checksum: 'events-checksum',
      storageKey: 'uploads/events.csv',
      uploadedAt,
    }),
  ];

  const files: FileRepository = {
    create: (asset) => Promise.resolve(asset),
    getById: (id) => Promise.resolve(assets.find((asset) => asset.id === id) ?? null),
    list: () => Promise.resolve(assets),
  };

  const workflow = createAccountFaultWorkflow({
    files,
    storage,
    classifier: new NoopClassificationProvider(),
  });

  const ctx = createStepContext({
    runId: 'run-account-faults',
    workflowSlug: workflow.slug,
    workflowVersion: workflow.version,
    logger: CapturingLogger.create(),
    clock: fixedClock('2026-03-05T06:00:00Z'),
  });

  const execution = await workflow.execute(
    { primaryFileId: 'file-primary', eventsFileId: 'file-events', ...input },
    ctx,
  );

  return { execution, storage };
}

function rowsFor(execution: WorkflowExecution<WorkflowOutputs>, account: string) {
  return (execution.state?.outputRows ?? []).filter((row) => row['Account Number'] === account);
}

describe('account fault triage workflow', () => {
  it('completes with a full execution trace', async () => {
    const { execution } = await runWorkflow();

    expect(execution.status).toBe('succeeded');
    expect(execution.error).toBeNull();
    expect(execution.steps.map((step) => step.stepId)).toEqual([
      'load-primary',
      'load-events',
      'group-events',
      'classify',
      'build-output',
    ]);
    expect(execution.steps.every((step) => step.status === 'succeeded')).toBe(true);
  });

  it('produces one output row per primary record with business columns filled', async () => {
    const { execution } = await runWorkflow();
    const state = execution.state!;

    expect(state.outputRows).toHaveLength(10);
    expect(state.outputColumns).toEqual([
      'Account Number',
      'Site Name',
      'RootCause',
      'FaultCategory',
      'RecommendedAction',
      'Priority',
      '__FaultCount',
      '__LatestFaultAt',
      '__MatchedRules',
      '__DecisionConfidence',
      '__ReviewStatus',
      '__ReviewReasons',
      '__Explanation',
    ]);

    const [northRidge] = rowsFor(execution, '1001');
    expect(northRidge).toMatchObject({
      RootCause: 'Power Loss',
      FaultCategory: 'Power',
      RecommendedAction: 'Verify supply and dispatch technician',
      Priority: 'P2',
      __FaultCount: 1,
      __ReviewStatus: 'AUTO_APPROVED',
      __MatchedRules: 'power-loss',
    });
  });

  it('selects the latest fault per account', async () => {
    const { execution } = await runWorkflow();
    const [harborPoint] = rowsFor(execution, '1002');

    expect(harborPoint?.['RootCause']).toBe('Battery Degraded');
    expect(harborPoint?.['__LatestFaultAt']).toBe('2026-03-02T10:30:00.000Z');
    expect(harborPoint?.['__FaultCount']).toBe(2);
  });

  it('auto-approves accounts with multiple consistent faults', async () => {
    const { execution } = await runWorkflow();
    const [summitPark] = rowsFor(execution, '1005');

    expect(summitPark?.['RootCause']).toBe('Power Loss');
    expect(summitPark?.['__FaultCount']).toBe(2);
    expect(summitPark?.['__ReviewStatus']).toBe('AUTO_APPROVED');
  });

  it('flags accounts with a conflicting fault history', async () => {
    const { execution } = await runWorkflow();
    const [harborPoint] = rowsFor(execution, '1002');

    expect(harborPoint?.['__ReviewStatus']).toBe('REVIEW_REQUIRED');
    expect(harborPoint?.['__ReviewReasons']).toBe('conflicting_fault_history');
  });

  it('flags accounts with unmatched descriptions at low confidence', async () => {
    const { execution } = await runWorkflow();

    expect(rowsFor(execution, '1004')[0]?.['__ReviewReasons']).toBe('no_rule_match');
    expect(rowsFor(execution, '1006')[0]?.['__ReviewReasons']).toBe('low_confidence');
    expect(rowsFor(execution, '1006')[0]?.['RootCause']).toBe('Unspecified Fault');
    expect(rowsFor(execution, '1003')[0]?.['__ReviewReasons']).toBe('no_events');
  });

  it('detects ambiguous latest timestamps', async () => {
    const { execution } = await runWorkflow();
    const reasons = String(rowsFor(execution, '1009')[0]?.['__ReviewReasons'] ?? '');

    expect(reasons).toContain('ambiguous_latest_timestamp');
    expect(reasons).toContain('conflicting_fault_history');
  });

  it('emits duplicate primary keys as critical review items', async () => {
    const { execution } = await runWorkflow();
    const duplicateRows = rowsFor(execution, '1008');
    const item = execution.state!.reviewItems.find((entry) => entry.entityKey === '1008');

    expect(duplicateRows).toHaveLength(2);
    expect(item?.reason).toBe('duplicate_primary_key');
    expect(item?.severity).toBe('critical');
  });

  it('routes exactly the unusual accounts to the review queue', async () => {
    const { execution } = await runWorkflow();
    const state = execution.state!;

    expect(state.reviewItems.map((item) => item.entityKey).sort()).toEqual([
      '1002',
      '1003',
      '1004',
      '1006',
      '1007',
      '1008',
      '1009',
    ]);
    expect(state.decisionRecords).toHaveLength(9);
    expect(state.decisionRecords.every((record) => record.aiAssisted === false)).toBe(true);
  });

  it('records explainable decisions for every account', async () => {
    const { execution } = await runWorkflow();
    const state = execution.state!;
    const decision = state.decisionRecords.find((record) => record.entityKey === '1002');
    const evidence = decision?.evidence as {
      matchedTerm?: string;
      explanation?: string;
      ai?: { reason?: string };
      latestFault?: { description?: string };
    };

    expect(decision?.matchedRuleIds).toEqual(['battery-degraded']);
    expect(decision?.confidence).toBeCloseTo(0.92);
    expect(evidence.latestFault?.description).toBe('Battery low warning repeated');
    expect(evidence.matchedTerm).toBe('battery low');
    expect(evidence.explanation).toContain('degraded backup battery');

    const unmatched = state.decisionRecords.find((record) => record.entityKey === '1004');
    expect(decision?.reviewReasons).toEqual(['conflicting_fault_history']);
    expect(unmatched?.reviewReasons).toEqual(['no_rule_match']);
    expect((unmatched?.evidence as { ai?: { reason?: string } }).ai?.reason).toBe('no_rule_match');
  });

  it('reports workflow statistics', async () => {
    const { execution } = await runWorkflow();
    const stats = execution.state!.stats;

    expect(stats).toMatchObject({
      primaryRows: 10,
      eventRows: 13,
      accounts: 9,
      accountsWithEvents: 8,
      accountsWithoutEvents: 1,
      orphanEventAccounts: 1,
      ruleMatchedAccounts: 6,
      autoApprovedAccounts: 2,
      reviewAccounts: 7,
      outputRows: 10,
    });
    expect(stats.ruleMatchRate).toBeCloseTo(0.6667);
  });

  it('evaluates a per-run rule set including history-scoped conditions', async () => {
    const ruleSet = ruleSetSchema.parse({
      slug: 'custom-history',
      workflowSlug: 'account-fault-triage',
      name: 'Custom history rules',
      version: 1,
      rules: [
        {
          id: 'history-battery',
          name: 'Battery seen anywhere in history',
          priority: 200,
          when: {
            mode: 'all',
            conditions: [
              {
                field: 'description',
                operator: 'contains',
                value: 'battery',
                scope: 'any_event',
              },
            ],
          },
          then: [
            { field: 'RootCause', value: 'History Battery' },
            { field: 'FaultCategory', value: 'Power' },
            { field: 'RecommendedAction', value: 'Review fault history' },
            { field: 'Priority', value: 'P2' },
          ],
          confidence: 0.99,
          explanationTemplate: 'Account history contains a battery fault.',
        },
      ],
    });

    const { execution } = await runWorkflow({ ruleSet });
    const [harborPoint] = rowsFor(execution, '1002');
    const decision = execution.state!.decisionRecords.find((record) => record.entityKey === '1002');
    const evidence = decision?.evidence as {
      ruleStatus?: string;
      evaluatedConditions?: Array<{ scope?: string; matched?: boolean }>;
    };

    expect(harborPoint?.['RootCause']).toBe('History Battery');
    expect(harborPoint?.['__MatchedRules']).toBe('history-battery');
    expect(decision?.matchedRuleIds).toEqual(['history-battery']);
    expect(evidence.ruleStatus).toBe('matched');
    expect(evidence.evaluatedConditions?.[0]?.scope).toBe('any_event');
    expect(evidence.evaluatedConditions?.[0]?.matched).toBe(true);
  });

  it('flags a no-match outcome as needing review in the decision evidence', async () => {
    const ruleSet = ruleSetSchema.parse({
      slug: 'custom-strict',
      workflowSlug: 'account-fault-triage',
      name: 'Strict rules',
      version: 1,
      rules: [
        {
          id: 'never',
          name: 'Never matches this sample',
          priority: 10,
          when: {
            mode: 'all',
            conditions: [{ field: 'description', operator: 'contains', value: 'quantum flux' }],
          },
          then: [{ field: 'RootCause', value: 'Quantum' }],
          confidence: 1,
          explanationTemplate: 'quantum',
        },
      ],
    });

    const { execution } = await runWorkflow({ ruleSet });
    const decision = execution.state!.decisionRecords.find((record) => record.entityKey === '1001');
    const evidence = decision?.evidence as {
      ruleStatus?: string;
      needsReview?: boolean;
      ruleReviewReasons?: string[];
    };

    expect(evidence.ruleStatus).toBe('no_match');
    expect(evidence.needsReview).toBe(true);
    expect(evidence.ruleReviewReasons).toContain('no_rule_match');
  });
});
