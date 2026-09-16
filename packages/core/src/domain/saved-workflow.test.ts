import { describe, expect, it } from 'vitest';
import { datasetProfileSchema, type DatasetProfile } from './dataset.js';
import { rebindConfiguration } from './saved-workflow.js';
import { workflowConfigurationSchema, type WorkflowConfiguration } from './workflow-config.js';

const now = new Date('2026-03-01T00:00:00.000Z');

function dataset(id: string, columns: string[]): DatasetProfile {
  return datasetProfileSchema.parse({
    id,
    fileId: `file-${id}`,
    kind: 'primary',
    originalName: `${id}.csv`,
    format: 'csv',
    mimeType: 'text/csv',
    sizeBytes: 1024,
    checksum: `checksum-${id}`,
    inspectedAt: now,
    scanLimit: 200000,
    rowCount: 3,
    columns: columns.map((name, index) => ({
      name,
      index,
      type: 'string',
      nonEmptyCount: 3,
      emptyCount: 0,
      emptyRatio: 0,
      uniqueCount: 3,
      uniqueRatio: 1,
      sampleValues: ['a', 'b'],
    })),
  });
}

function configuration(): WorkflowConfiguration {
  return workflowConfigurationSchema.parse({
    id: 'cfg-1',
    workflowSlug: 'account-fault-triage',
    workflowVersion: 1,
    name: 'Daily triage',
    description: '',
    version: 3,
    assignments: [
      { role: 'primary', datasetId: 'old-primary', sheetName: null },
      { role: 'events', datasetId: 'old-events', sheetName: null },
    ],
    mappings: [
      { role: 'primaryEntityKey', datasetId: 'old-primary', column: 'Account', confirmed: true },
      { role: 'eventsEntityKey', datasetId: 'old-events', column: 'Account', confirmed: false },
      { role: 'eventsTimestamp', datasetId: 'old-events', column: 'Fault Date', confirmed: false },
      { role: 'eventsDescription', datasetId: 'old-events', column: 'Notes', confirmed: false },
    ],
    options: { reviewBelowConfidence: 0.8 },
    createdAt: now,
    updatedAt: now,
  });
}

describe('rebindConfiguration', () => {
  it('carries every mapping by column name onto a new day of files', () => {
    const plan = rebindConfiguration({
      configuration: configuration(),
      requested: [
        { role: 'primary', datasetId: 'new-primary' },
        { role: 'events', datasetId: 'new-events' },
      ],
      datasets: [
        dataset('new-primary', ['Account', 'RootCause']),
        dataset('new-events', ['Account', 'Fault Date', 'Notes']),
      ],
    });

    expect(plan.assignments).toEqual([
      { role: 'primary', datasetId: 'new-primary', sheetName: null },
      { role: 'events', datasetId: 'new-events', sheetName: null },
    ]);
    expect(plan.mappings).toHaveLength(4);
    expect(plan.mappings.every((mapping) => mapping.confirmed === false)).toBe(true);
    expect(plan.mappings.find((mapping) => mapping.role === 'eventsTimestamp')).toMatchObject({
      datasetId: 'new-events',
      column: 'Fault Date',
    });
    expect(plan.carried.map((entry) => entry.column).sort()).toEqual([
      'Account',
      'Account',
      'Fault Date',
      'Notes',
    ]);
    expect(plan.dropped).toEqual([]);
    expect(plan.datasetChanges).toEqual(
      expect.arrayContaining([
        { role: 'primary', previousDatasetId: 'old-primary', datasetId: 'new-primary' },
        { role: 'events', previousDatasetId: 'old-events', datasetId: 'new-events' },
      ]),
    );
  });

  it('reports a mapping that cannot be carried instead of silently guessing a column', () => {
    const plan = rebindConfiguration({
      configuration: configuration(),
      requested: [
        { role: 'primary', datasetId: 'new-primary' },
        { role: 'events', datasetId: 'new-events' },
      ],
      datasets: [dataset('new-primary', ['Account']), dataset('new-events', ['Account', 'Notes'])],
    });

    expect(plan.mappings.map((mapping) => mapping.role)).not.toContain('eventsTimestamp');
    expect(plan.dropped).toContainEqual({
      role: 'eventsTimestamp',
      column: 'Fault Date',
      reason: 'column_not_found',
    });
  });

  it('only re-points the roles the user supplied and leaves the rest intact', () => {
    const original = configuration();
    const plan = rebindConfiguration({
      configuration: original,
      requested: [{ role: 'primary', datasetId: 'new-primary' }],
      datasets: [dataset('new-primary', ['Account'])],
    });

    expect(plan.assignments).toEqual([
      { role: 'primary', datasetId: 'new-primary', sheetName: null },
      { role: 'events', datasetId: 'old-events', sheetName: null },
    ]);
    // The untouched events mappings keep their dataset and their earlier confirmation.
    expect(plan.mappings.find((mapping) => mapping.role === 'eventsDescription')).toMatchObject({
      datasetId: 'old-events',
      column: 'Notes',
    });
    expect(plan.datasetChanges).toEqual([
      { role: 'primary', previousDatasetId: 'old-primary', datasetId: 'new-primary' },
    ]);
  });

  it('keeps the confirmation when a mapping points at the same file as before', () => {
    const plan = rebindConfiguration({
      configuration: configuration(),
      requested: [
        { role: 'primary', datasetId: 'old-primary' },
        { role: 'events', datasetId: 'old-events' },
      ],
      datasets: [
        dataset('old-primary', ['Account']),
        dataset('old-events', ['Account', 'Fault Date', 'Notes']),
      ],
    });

    expect(plan.datasetChanges).toEqual([]);
    expect(plan.mappings.find((mapping) => mapping.role === 'primaryEntityKey')?.confirmed).toBe(
      true,
    );
  });
});
