import { describe, expect, it } from 'vitest';
import { runSnapshotSchema, toRunSnapshotSummary } from './run-snapshot.js';
import type { Rule } from './rules.js';
import { workflowConfigurationSchema } from './workflow-config.js';

const now = new Date('2026-02-01T00:00:00.000Z');

const rule: Rule = {
  id: 'rule-1',
  name: 'Rule 1',
  description: '',
  enabled: true,
  priority: 10,
  when: {
    mode: 'all',
    conditions: [
      {
        field: 'description',
        operator: 'contains',
        value: 'power',
        caseSensitive: false,
        scope: 'latest',
      },
    ],
  },
  then: [{ type: 'set', field: 'RootCause', value: 'Power Loss' }],
  confidence: 0.9,
  explanationTemplate: '',
  tags: [],
};

const configuration = workflowConfigurationSchema.parse({
  id: 'cfg-1',
  workflowSlug: 'account-fault-triage',
  workflowVersion: 3,
  name: 'Monthly sites',
  description: '',
  version: 2,
  assignments: [{ role: 'primary', datasetId: 'ds-1', sheetName: null }],
  mappings: [],
  options: {},
  createdAt: now,
  updatedAt: now,
});

describe('run snapshot', () => {
  it('defaults the frozen configuration and rule set to null when a run has neither', () => {
    const snapshot = runSnapshotSchema.parse({
      id: 'snap-1',
      runId: 'run-1',
      workflowSlug: 'account-fault-triage',
      workflowVersion: 1,
      capturedAt: now,
    });
    expect(snapshot.configurationId).toBeNull();
    expect(snapshot.configuration).toBeNull();
    expect(snapshot.ruleSetId).toBeNull();
    expect(snapshot.ruleSet).toBeNull();
  });

  it('summarises the version numbers, names and rule count immutably', () => {
    const snapshot = runSnapshotSchema.parse({
      id: 'snap-2',
      runId: 'run-2',
      workflowSlug: 'account-fault-triage',
      workflowVersion: 3,
      configurationId: 'cfg-1',
      configuration,
      ruleSetId: 'rs-1',
      ruleSet: {
        id: 'rs-1',
        slug: 'account-fault-triage-default',
        workflowSlug: 'account-fault-triage',
        name: 'Default',
        version: 4,
        active: true,
        rules: [rule],
        createdAt: now,
        updatedAt: now,
      },
      capturedAt: now,
    });

    const summary = toRunSnapshotSummary(snapshot);
    expect(summary).toMatchObject({
      runId: 'run-2',
      workflowVersion: 3,
      configurationId: 'cfg-1',
      configurationVersion: 2,
      configurationName: 'Monthly sites',
      ruleSetId: 'rs-1',
      ruleSetVersion: 4,
      ruleSetName: 'Default',
      ruleCount: 1,
    });
  });
});
