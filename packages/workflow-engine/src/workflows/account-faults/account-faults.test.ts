import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CapturingLogger,
  fileAssetSchema,
  fixedClock,
  ruleSetSchema,
  type AiClassificationRequest,
  type AiClassificationResult,
  type ClassificationProvider,
  type FileAsset,
  type FileRepository,
} from '@sheetpilot/core';
import { InMemoryFileStorage } from '@sheetpilot/file-processing';
import { NoopClassificationProvider, AiProviderError } from '@sheetpilot/ai';
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

class RecordingProvider implements ClassificationProvider {
  readonly id = 'recording';
  readonly displayName = 'Recording provider';
  readonly model = 'recording-1';
  readonly requests: AiClassificationRequest[] = [];

  constructor(
    private readonly respond: (
      request: AiClassificationRequest,
    ) => AiClassificationResult | Promise<AiClassificationResult>,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async classify(request: AiClassificationRequest): Promise<AiClassificationResult> {
    this.requests.push(request);
    return this.respond(request);
  }
}

function aiResult(
  proposedCode: string,
  confidence: number,
  extra: Partial<AiClassificationResult> = {},
): AiClassificationResult {
  return {
    proposedCode,
    proposedLabel: proposedCode,
    confidence,
    reasoning: 'model reasoning',
    ambiguity: [],
    missingInformation: [],
    ...extra,
  };
}

async function runWorkflow(
  input: Record<string, unknown> = {},
  classifier: ClassificationProvider = new NoopClassificationProvider(),
): Promise<Harness> {
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
    delete: () => Promise.resolve(),
  };

  const workflow = createAccountFaultWorkflow({
    files,
    storage,
    classifier,
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
      '__FaultSummary',
      '__MatchedRules',
      '__DecisionSource',
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

  it('emits output rows in the primary file order with blanks for missing values', async () => {
    const { execution } = await runWorkflow();
    const rows = execution.state!.outputRows;

    expect(rows.map((row) => row['Account Number'])).toEqual([
      '1001',
      '1002',
      '1003',
      '1004',
      '1005',
      '1006',
      '1007',
      '1008',
      '1008',
      '1009',
    ]);

    const noEvents = rows.find((row) => row['Account Number'] === '1003');
    expect(noEvents?.['RootCause']).toBeNull();
    expect(noEvents?.['Priority']).toBeNull();
    expect(noEvents?.['__LatestFaultAt']).toBeNull();
  });

  it('selects the latest fault per account', async () => {
    const { execution } = await runWorkflow();
    const [harborPoint] = rowsFor(execution, '1002');

    expect(harborPoint?.['RootCause']).toBe('Battery Degraded');
    expect(harborPoint?.['__LatestFaultAt']).toBe('2026-03-02T10:30:00.000Z');
    expect(harborPoint?.['__FaultCount']).toBe(2);
  });

  it('combines every fault description into a single, deterministic summary', async () => {
    const { execution } = await runWorkflow();
    const [harborPoint] = rowsFor(execution, '1002');

    expect(harborPoint?.['__FaultSummary']).toBe(
      'Sensor fault on channel 2 | Battery low warning repeated',
    );
  });

  it('writes results into user-mapped columns instead of new ones', async () => {
    const { execution } = await runWorkflow({
      config: { outputFaultCategoryColumn: 'Fault Category' },
    });
    const state = execution.state!;
    const [northRidge] = rowsFor(execution, '1001');

    expect(state.outputColumns).toContain('Fault Category');
    expect(northRidge?.['Fault Category']).toBe('Power');
    expect(northRidge?.['RootCause']).toBe('Power Loss');
  });

  it('always keeps the identifier column even when it is excluded from the result columns', async () => {
    const { execution } = await runWorkflow({ config: { primaryOutputColumns: ['Site Name'] } });
    const state = execution.state!;
    const [northRidge] = rowsFor(execution, '1001');

    expect(state.outputColumns[0]).toBe('Account Number');
    expect(state.outputColumns).toContain('Site Name');
    expect(northRidge?.['Account Number']).toBe('1001');
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
      unmatchedAccounts: 3,
      processingErrorAccounts: 0,
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

  it('applies a confident AI proposal only when no rule matched and auto-approval is enabled', async () => {
    const classifier = new RecordingProvider(() => aiResult('SENSOR_FAULT', 0.95));
    const { execution } = await runWorkflow(
      { config: { aiPolicy: 'on_no_rule_match', aiAutoApprove: true, aiMinConfidence: 0.9 } },
      classifier,
    );

    const [elmStreet] = rowsFor(execution, '1004');
    expect(elmStreet?.['RootCause']).toBe('Sensor Fault');
    expect(elmStreet?.['FaultCategory']).toBe('Hardware');
    expect(elmStreet?.['__DecisionSource']).toBe('ai_suggested');
    expect(elmStreet?.['__ReviewStatus']).toBe('AUTO_APPROVED');

    const decision = execution.state!.decisionRecords.find((record) => record.entityKey === '1004');
    expect(decision?.decisionSource).toBe('ai_suggested');
    expect(decision?.aiAssisted).toBe(true);
    expect(decision?.confidence).toBeCloseTo(0.95);
  });

  it('never lets AI override a confident deterministic rule', async () => {
    const classifier = new RecordingProvider(() => aiResult('SENSOR_FAULT', 0.99));
    const { execution } = await runWorkflow(
      { config: { aiPolicy: 'always', aiAutoApprove: true, aiMinConfidence: 0.5 } },
      classifier,
    );

    const [northRidge] = rowsFor(execution, '1001');
    expect(northRidge?.['RootCause']).toBe('Power Loss');
    expect(northRidge?.['__DecisionSource']).toBe('deterministic');

    const decision = execution.state!.decisionRecords.find((record) => record.entityKey === '1001');
    expect(decision?.decisionSource).toBe('deterministic');
    expect(decision?.reviewReasons).toContain('ai_proposed_alternative');
  });

  it('routes a low-confidence AI proposal to review', async () => {
    const classifier = new RecordingProvider(() => aiResult('SENSOR_FAULT', 0.5));
    const { execution } = await runWorkflow(
      { config: { aiPolicy: 'on_no_rule_match', aiAutoApprove: true, aiMinConfidence: 0.9 } },
      classifier,
    );

    const [elmStreet] = rowsFor(execution, '1004');
    expect(elmStreet?.['RootCause']).toBe('Sensor Fault');
    expect(String(elmStreet?.['__ReviewReasons'])).toContain('ai_low_confidence');
  });

  it('survives a provider failure and records it as a review reason', async () => {
    const classifier = new RecordingProvider(() => {
      throw new AiProviderError('provider exploded', {
        kind: 'provider_error',
        retryable: false,
      });
    });
    const { execution } = await runWorkflow(
      { config: { aiPolicy: 'on_no_rule_match' } },
      classifier,
    );

    expect(execution.status).toBe('succeeded');
    const [elmStreet] = rowsFor(execution, '1004');
    expect(String(elmStreet?.['__ReviewReasons'])).toContain('ai_failed');
  });

  it('sends only bounded, non-row data to the AI provider', async () => {
    const classifier = new RecordingProvider(() => aiResult('SENSOR_FAULT', 0.9));
    await runWorkflow({ config: { aiPolicy: 'on_no_rule_match' } }, classifier);

    const first = classifier.requests[0];
    expect(first).toBeDefined();
    expect(first?.latestEvent?.fields).toEqual({});
    expect(first?.entityKey).toBe('1004');
    expect(first?.eventHistory.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(first)).not.toContain('Elm Street');
  });
});
