import { describe, expect, it } from 'vitest';
import {
  datasetProfileSchema,
  validateWorkflowConfiguration,
  type ColumnMapping,
  type DatasetColumn,
  type DatasetProfile,
  type WorkflowConfigurationDefinition,
} from '../index.js';

const definition: WorkflowConfigurationDefinition = {
  datasetRoles: [
    { key: 'primary', label: 'Primary', description: '', required: true, multiple: false },
    { key: 'events', label: 'Events', description: '', required: true, multiple: false },
    { key: 'reference', label: 'Reference', description: '', required: false, multiple: true },
  ],
  columnRoles: [
    {
      key: 'primaryEntityKey',
      label: 'Primary account',
      description: '',
      datasetRole: 'primary',
      semantic: 'identifier',
      required: true,
      multiple: false,
      configKey: 'primaryAccountColumn',
    },
    {
      key: 'eventsEntityKey',
      label: 'Events account',
      description: '',
      datasetRole: 'events',
      semantic: 'identifier',
      required: true,
      multiple: false,
      configKey: 'eventsAccountColumn',
    },
    {
      key: 'eventsTimestamp',
      label: 'Events timestamp',
      description: '',
      datasetRole: 'events',
      semantic: 'timestamp',
      required: true,
      multiple: false,
      configKey: 'eventsTimestampColumn',
    },
  ],
  options: [
    {
      key: 'reviewBelowConfidence',
      label: 'Review below confidence',
      kind: 'number',
      required: true,
      defaultValue: 0.8,
      description: '',
    },
  ],
};

function column(
  name: string,
  index: number,
  type: DatasetColumn['type'],
  extra: Partial<DatasetColumn> = {},
): DatasetColumn {
  return {
    name,
    index,
    type,
    nonEmptyCount: 10,
    emptyCount: 0,
    emptyRatio: 0,
    uniqueCount: 10,
    uniqueRatio: 1,
    sampleValues: [],
    duplicateName: false,
    likelyDate: false,
    likelyIdentifier: false,
    ...extra,
  };
}

function dataset(id: string, columns: DatasetColumn[]): DatasetProfile {
  return datasetProfileSchema.parse({
    id,
    fileId: `${id}-file`,
    kind: 'generic',
    originalName: `${id}.csv`,
    format: 'csv',
    mimeType: 'text/csv',
    sizeBytes: 100,
    checksum: 'checksum',
    inspectedAt: new Date('2026-01-01T00:00:00.000Z'),
    rowCount: 10,
    scanLimit: 200000,
    columns,
  });
}

const primary = dataset('primary', [
  column('Account Number', 0, 'string', { likelyIdentifier: true }),
]);
const events = dataset('events', [
  column('Account Number', 0, 'string', { likelyIdentifier: true }),
  column('Fault Date', 1, 'date', { likelyDate: true }),
  column('Fault Description', 2, 'string'),
]);

const baseMappings: ColumnMapping[] = [
  {
    role: 'primaryEntityKey',
    datasetId: 'primary',
    sheetName: null,
    column: 'Account Number',
    confirmed: false,
  },
  {
    role: 'eventsEntityKey',
    datasetId: 'events',
    sheetName: null,
    column: 'Account Number',
    confirmed: false,
  },
  {
    role: 'eventsTimestamp',
    datasetId: 'events',
    sheetName: null,
    column: 'Fault Date',
    confirmed: false,
  },
];

function validate(overrides: {
  assignments?: Array<{ role: string; datasetId: string; sheetName: null }>;
  mappings?: ColumnMapping[];
  options?: Record<string, string | number | boolean>;
  datasets?: DatasetProfile[];
}) {
  return validateWorkflowConfiguration({
    definition,
    configuration: {
      assignments: overrides.assignments ?? [
        { role: 'primary', datasetId: 'primary', sheetName: null },
        { role: 'events', datasetId: 'events', sheetName: null },
      ],
      mappings: overrides.mappings ?? baseMappings,
      options: overrides.options ?? { reviewBelowConfidence: 0.8 },
    },
    datasets: overrides.datasets ?? [primary, events],
  });
}

describe('validateWorkflowConfiguration', () => {
  it('accepts a complete, compatible configuration', () => {
    const result = validate({});
    expect(result.valid).toBe(true);
    expect(result.issues.filter((entry) => entry.severity === 'error')).toHaveLength(0);
  });

  it('reports missing required dataset roles', () => {
    const result = validate({
      assignments: [{ role: 'primary', datasetId: 'primary', sheetName: null }],
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'missing_dataset_role', role: 'events', severity: 'error' }),
    );
  });

  it('reports datasets that do not exist', () => {
    const result = validate({
      assignments: [
        { role: 'primary', datasetId: 'ghost', sheetName: null },
        { role: 'events', datasetId: 'events', sheetName: null },
      ],
      datasets: [events],
    });
    expect(result.issues.some((entry) => entry.code === 'unknown_dataset')).toBe(true);
  });

  it('reports missing required column mappings and unknown columns', () => {
    const result = validate({
      mappings: baseMappings.filter((mapping) => mapping.role !== 'eventsTimestamp'),
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'missing_required_column', role: 'eventsTimestamp' }),
    );

    const unknown = validate({
      mappings: baseMappings.map((mapping) =>
        mapping.role === 'eventsTimestamp' ? { ...mapping, column: 'Nope' } : mapping,
      ),
    });
    expect(unknown.issues.some((entry) => entry.code === 'unknown_column')).toBe(true);
  });

  it('requires confirmation before accepting a date-like identifier', () => {
    const dateColumnDataset = dataset('primary', [
      column('Account Number', 0, 'date', { likelyDate: true }),
    ]);
    const unconfirmed = validate({ datasets: [dateColumnDataset, events] });
    expect(unconfirmed.valid).toBe(false);
    expect(unconfirmed.issues.some((entry) => entry.code === 'incompatible_identifier')).toBe(true);

    const confirmed = validate({
      datasets: [dateColumnDataset, events],
      mappings: baseMappings.map((mapping) =>
        mapping.role === 'primaryEntityKey' ? { ...mapping, confirmed: true } : mapping,
      ),
    });
    expect(confirmed.valid).toBe(true);
    expect(confirmed.issues).toContainEqual(
      expect.objectContaining({ code: 'incompatible_identifier', severity: 'warning' }),
    );
  });

  it('requires confirmation for a string timestamp that only parses in sample values', () => {
    const stringDateEvents = dataset('events', [
      column('Account Number', 0, 'string', { likelyIdentifier: true }),
      column('Fault Date', 1, 'string', { sampleValues: ['2026-03-04', '2026-03-05'] }),
      column('Fault Description', 2, 'string'),
    ]);

    const unconfirmed = validate({ datasets: [primary, stringDateEvents] });
    expect(unconfirmed.valid).toBe(false);
    expect(unconfirmed.issues.some((entry) => entry.code === 'unparseable_timestamp')).toBe(true);

    const confirmed = validate({
      datasets: [primary, stringDateEvents],
      mappings: baseMappings.map((mapping) =>
        mapping.role === 'eventsTimestamp' ? { ...mapping, confirmed: true } : mapping,
      ),
    });
    expect(confirmed.valid).toBe(true);
  });

  it('rejects a timestamp column that is not parseable even after confirmation', () => {
    const badEvents = dataset('events', [
      column('Account Number', 0, 'string', { likelyIdentifier: true }),
      column('Fault Date', 1, 'string', { sampleValues: ['yes', 'no'] }),
      column('Fault Description', 2, 'string'),
    ]);
    const result = validate({
      datasets: [primary, badEvents],
      mappings: baseMappings.map((mapping) =>
        mapping.role === 'eventsTimestamp' ? { ...mapping, confirmed: true } : mapping,
      ),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((entry) => entry.code === 'unparseable_timestamp')).toBe(true);
  });

  it('rejects empty columns used as identifiers', () => {
    const emptyPrimary = dataset('primary', [column('Account Number', 0, 'empty')]);
    const result = validate({ datasets: [emptyPrimary, events] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((entry) => entry.code === 'empty_column')).toBe(true);
  });

  it('validates required options', () => {
    const missing = validate({ options: {} });
    expect(missing.issues).toContainEqual(
      expect.objectContaining({ code: 'missing_option', role: 'reviewBelowConfidence' }),
    );

    const invalid = validate({ options: { reviewBelowConfidence: 'high' } });
    expect(invalid.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_option', role: 'reviewBelowConfidence' }),
    );
  });

  it('warns about extra datasets assigned to a single-value role', () => {
    const result = validate({
      assignments: [
        { role: 'primary', datasetId: 'primary', sheetName: null },
        { role: 'events', datasetId: 'events', sheetName: null },
        { role: 'events', datasetId: 'primary', sheetName: null },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.issues.some((entry) => entry.code === 'duplicate_dataset_assignment')).toBe(true);
  });
});
