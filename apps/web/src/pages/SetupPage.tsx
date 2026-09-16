import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  ColumnMapping,
  ColumnRoleDefinition,
  ConfigurationIssue,
  DatasetAssignment,
  DatasetColumn,
  WorkflowConfigurationDto,
} from '@sheetpilot/core';
import { ApiError } from '../api/client.js';
import {
  useCreateRun,
  useCreateWorkflowConfiguration,
  useDatasetDetails,
  useDatasets,
  useUpdateWorkflowConfiguration,
  useValidateWorkflowConfiguration,
  useWorkflow,
  useWorkflowConfiguration,
  useWorkflows,
} from '../api/hooks.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  KeyValue,
  LoadingState,
  PageHeader,
} from '../components/ui.js';
import {
  datasetLabel,
  issueTone,
  issuesForRole,
  roleNeedsConfirmation,
  suggestColumnName,
} from '../lib/configurations.js';

type OptionValue = string | number | boolean;

function columnOptionLabel(column: DatasetColumn): string {
  const flags: string[] = [column.type];
  if (column.likelyDate) {
    flags.push('date-like');
  }
  if (column.likelyIdentifier) {
    flags.push('identifier-like');
  }
  return `${column.name} — ${flags.join(', ')}`;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : 'The request failed.';
}

export function SetupPage() {
  const { configurationId } = useParams<{ configurationId: string }>();
  const navigate = useNavigate();

  const workflows = useWorkflows();
  const [slug, setSlug] = useState('');
  const workflow = useWorkflow(slug || undefined);
  const definition = workflow.data?.configuration;
  const datasets = useDatasets();
  const existing = useWorkflowConfiguration(configurationId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [singleMappings, setSingleMappings] = useState<Record<string, string>>({});
  const [multiMappings, setMultiMappings] = useState<Record<string, string[]>>({});
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});
  const [options, setOptions] = useState<Record<string, OptionValue>>({});
  const [saved, setSaved] = useState<WorkflowConfigurationDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validate = useValidateWorkflowConfiguration();
  const create = useCreateWorkflowConfiguration();
  const update = useUpdateWorkflowConfiguration();
  const createRun = useCreateRun();

  useEffect(() => {
    if (slug.length > 0) {
      return;
    }
    const fallback = existing.data?.workflowSlug ?? workflows.data?.items[0]?.slug;
    if (fallback) {
      setSlug(fallback);
    }
  }, [slug, existing.data, workflows.data]);

  useEffect(() => {
    if (!existing.data) {
      return;
    }
    const configuration = existing.data;
    setSlug(configuration.workflowSlug);
    setSaved(configuration);
    setName(configuration.name);
    setDescription(configuration.description);
    const nextAssignments: Record<string, string> = {};
    for (const assignment of configuration.assignments) {
      if (nextAssignments[assignment.role] === undefined) {
        nextAssignments[assignment.role] = assignment.datasetId;
      }
    }
    setAssignments(nextAssignments);
    const nextSingle: Record<string, string> = {};
    const nextMulti: Record<string, string[]> = {};
    const nextConfirmations: Record<string, boolean> = {};
    for (const mapping of configuration.mappings) {
      if (mapping.confirmed) {
        nextConfirmations[mapping.role] = true;
      }
      const existingSingle = nextSingle[mapping.role];
      const existingMulti = nextMulti[mapping.role];
      if (existingMulti) {
        nextMulti[mapping.role] = [...existingMulti, mapping.column];
      } else if (existingSingle === undefined) {
        nextSingle[mapping.role] = mapping.column;
      } else if (existingSingle !== mapping.column) {
        delete nextSingle[mapping.role];
        nextMulti[mapping.role] = [existingSingle, mapping.column];
      }
    }
    setSingleMappings(nextSingle);
    setMultiMappings(nextMulti);
    setConfirmations(nextConfirmations);
    setOptions(configuration.options);
  }, [existing.data]);

  useEffect(() => {
    if (!definition) {
      return;
    }
    setOptions((current) => {
      const next = { ...current };
      let changed = false;
      for (const option of definition.options) {
        if (next[option.key] === undefined && option.defaultValue !== null) {
          next[option.key] = option.defaultValue;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [definition]);

  const assignedIds = useMemo(
    () => [...new Set(Object.values(assignments).filter((value) => value.length > 0))],
    [assignments],
  );
  const datasetDetails = useDatasetDetails(assignedIds);
  const columnsByDatasetId = useMemo(() => {
    const map: Record<string, DatasetColumn[]> = {};
    for (const query of datasetDetails) {
      if (query.data) {
        map[query.data.id] = query.data.columns;
      }
    }
    return map;
  }, [datasetDetails]);

  useEffect(() => {
    if (!definition) {
      return;
    }
    setSingleMappings((current) => {
      const next = { ...current };
      let changed = false;
      for (const role of definition.columnRoles) {
        if (role.multiple || next[role.key]) {
          continue;
        }
        const datasetId = assignments[role.datasetRole];
        const columns = datasetId ? columnsByDatasetId[datasetId] : undefined;
        if (!columns) {
          continue;
        }
        const suggestion = suggestColumnName(role, columns, new Set(Object.values(next)));
        if (suggestion) {
          next[role.key] = suggestion;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [definition, assignments, columnsByDatasetId]);

  const assignmentList = useMemo<DatasetAssignment[]>(() => {
    if (!definition) {
      return [];
    }
    const list: DatasetAssignment[] = [];
    for (const role of definition.datasetRoles) {
      const datasetId = assignments[role.key];
      if (datasetId) {
        list.push({ role: role.key, datasetId, sheetName: null });
      }
    }
    return list;
  }, [definition, assignments]);

  const mappingList = useMemo<ColumnMapping[]>(() => {
    if (!definition) {
      return [];
    }
    const list: ColumnMapping[] = [];
    for (const role of definition.columnRoles) {
      const datasetId = assignments[role.datasetRole];
      if (!datasetId) {
        continue;
      }
      const single = singleMappings[role.key];
      const values = role.multiple ? (multiMappings[role.key] ?? []) : single ? [single] : [];
      for (const column of values) {
        if (column.length > 0) {
          list.push({
            role: role.key,
            datasetId,
            sheetName: null,
            column,
            confirmed: confirmations[role.key] ?? false,
          });
        }
      }
    }
    return list;
  }, [definition, assignments, singleMappings, multiMappings, confirmations]);

  const validationKey = JSON.stringify({ slug, assignmentList, mappingList, options });

  useEffect(() => {
    if (!slug || !definition) {
      return;
    }
    const handle = setTimeout(() => {
      validate.mutate({
        workflowSlug: slug,
        assignments: assignmentList,
        mappings: mappingList,
        options,
      });
    }, 350);
    return () => clearTimeout(handle);
    // validationKey captures every input that affects the payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationKey]);

  const validation = validate.data;
  const issues: ConfigurationIssue[] = validation?.issues ?? [];
  const valid = validation?.valid ?? false;
  const isSaving = create.isPending || update.isPending;

  const updateAssignment = (roleKey: string, datasetId: string) => {
    setAssignments((current) => ({ ...current, [roleKey]: datasetId }));
  };

  const updateSingleMapping = (roleKey: string, column: string) => {
    setSingleMappings((current) => ({ ...current, [roleKey]: column }));
    setConfirmations((current) => ({ ...current, [roleKey]: false }));
  };

  const toggleMultiMapping = (roleKey: string, column: string, checked: boolean) => {
    setMultiMappings((current) => {
      const values = current[roleKey] ?? [];
      return {
        ...current,
        [roleKey]: checked ? [...values, column] : values.filter((entry) => entry !== column),
      };
    });
  };

  const setOption = (key: string, value: OptionValue) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    if (!definition) {
      return;
    }
    const payload = {
      assignments: assignmentList,
      mappings: mappingList,
      options,
    };
    try {
      if (saved) {
        const result = await update.mutateAsync({
          id: saved.id,
          body: { name, description, ...payload },
        });
        setSaved(result);
        setNotice(`Configuration updated to version ${result.version}.`);
      } else {
        const result = await create.mutateAsync({
          workflowSlug: slug,
          name: name.trim().length > 0 ? name : `${workflow.data?.name ?? 'Workflow'} setup`,
          description,
          ...payload,
        });
        setSaved(result);
        setNotice(`Configuration saved as version ${result.version}.`);
        void navigate(`/setup/${result.id}`, { replace: true });
      }
    } catch (saveError) {
      setError(describeError(saveError));
    }
  };

  const continueToProcessing = async () => {
    if (!saved) {
      return;
    }
    setError(null);
    try {
      const run = await createRun.mutateAsync({ configurationId: saved.id, config: {} });
      void navigate(`/runs/${run.id}`);
    } catch (runError) {
      setError(describeError(runError));
    }
  };

  if (workflows.isLoading || !slug || (!workflow.data && workflow.isLoading)) {
    return <LoadingState label="Loading workflow setup…" />;
  }
  if (workflows.isError) {
    return <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />;
  }
  if (existing.isError) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }
  if (!definition) {
    return <EmptyState title="No workflow available" description="Register a workflow first." />;
  }

  const datasetItems = datasets.data?.items ?? [];

  return (
    <div className="page">
      <PageHeader
        title={configurationId ? 'Edit workflow setup' : 'Workflow setup'}
        description="Connect your uploaded files, map the columns the workflow needs, check the configuration, then start processing. Everything is saved so you can reuse it next month."
      />

      <Card title="Workflow" subtitle="Which recurring process are you configuring?">
        <div className="field-grid">
          <Field label="Workflow">
            <select
              className="input"
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value);
                setSaved(null);
                setAssignments({});
                setSingleMappings({});
                setMultiMappings({});
                setConfirmations({});
              }}
            >
              {(workflows.data?.items ?? []).map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Setup name" hint="Shown in the saved setups list.">
            <input
              className="input"
              type="text"
              value={name}
              placeholder={`${workflow.data?.name ?? 'Workflow'} setup`}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Description" hint="Optional note for your team.">
            <input
              className="input"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="1 · Assign your files to roles"
        subtitle="Tell the workflow which uploaded file plays which part."
        actions={<Link to="/datasets">Upload more files</Link>}
      >
        {datasetItems.length === 0 ? (
          <EmptyState
            title="No datasets yet"
            description="Upload at least the two files this workflow needs."
            action={<Link to="/datasets">Go to Datasets</Link>}
          />
        ) : (
          <div className="field-grid">
            {definition.datasetRoles.map((role) => (
              <Field
                key={role.key}
                label={role.required ? `${role.label} *` : role.label}
                hint={role.description}
              >
                <select
                  className="input"
                  value={assignments[role.key] ?? ''}
                  onChange={(event) => updateAssignment(role.key, event.target.value)}
                >
                  <option value="">— choose a dataset —</option>
                  {datasetItems.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {datasetLabel(dataset)}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="2 · Map the columns"
        subtitle="We suggest columns based on what we detected; adjust any that look wrong."
      >
        <div className="mapping-list">
          {definition.columnRoles.map((role) => {
            const datasetId = assignments[role.datasetRole];
            return (
              <MappingCard
                key={role.key}
                role={role}
                datasetId={datasetId}
                datasetName={
                  datasetItems.find((item) => item.id === datasetId)?.originalName ?? null
                }
                columns={datasetId ? (columnsByDatasetId[datasetId] ?? []) : []}
                singleValue={singleMappings[role.key] ?? ''}
                multiValues={multiMappings[role.key] ?? []}
                confirmed={confirmations[role.key] ?? false}
                issues={issuesForRole(issues, role.key)}
                loading={datasetDetails.some((query) => query.isLoading)}
                onSingleChange={(column) => updateSingleMapping(role.key, column)}
                onMultiChange={(column, checked) => toggleMultiMapping(role.key, column, checked)}
                onConfirmedChange={(value) =>
                  setConfirmations((current) => ({ ...current, [role.key]: value }))
                }
              />
            );
          })}
        </div>
      </Card>

      {definition.options.length > 0 ? (
        <Card title="3 · Options" subtitle="Tune how the workflow behaves.">
          <div className="field-grid">
            {definition.options.map((option) => {
              const value = options[option.key];
              return (
                <Field key={option.key} label={option.label} hint={option.description}>
                  {option.kind === 'boolean' ? (
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) => setOption(option.key, event.target.checked)}
                      />
                      <span>{option.description.length > 0 ? option.label : 'Enabled'}</span>
                    </label>
                  ) : option.kind === 'number' ? (
                    <input
                      className="input"
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={typeof value === 'number' ? value : ''}
                      onChange={(event) => setOption(option.key, Number(event.target.value))}
                    />
                  ) : (
                    <input
                      className="input"
                      type="text"
                      value={
                        typeof value === 'string' ? value : value === undefined ? '' : String(value)
                      }
                      onChange={(event) => setOption(option.key, event.target.value)}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card
        title="4 · Check the configuration"
        subtitle="Errors must be fixed; warnings should be confirmed before you continue."
        actions={
          validate.isPending ? (
            <Badge tone="info">checking…</Badge>
          ) : validation ? (
            <Badge tone={valid ? 'success' : 'danger'}>{valid ? 'ready' : 'needs attention'}</Badge>
          ) : null
        }
      >
        {issues.length === 0 ? (
          <EmptyState
            title={validation ? 'Everything checks out' : 'Not checked yet'}
            description={
              validation
                ? 'The mapped columns are compatible with this workflow.'
                : 'Validation runs automatically as you map columns.'
            }
          />
        ) : (
          <ul className="warning-list">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.role ?? index}-${index}`} className="warning-item">
                <Badge tone={issueTone(issue.severity)}>{issue.severity}</Badge>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}

        {validation?.resolvedConfig ? (
          <div className="resolved-config">
            <h3>What the processing step will use</h3>
            <KeyValue
              items={Object.entries(validation.resolvedConfig).map(([key, value]) => ({
                label: key,
                value: Array.isArray(value) ? value.join(', ') || '—' : String(value),
              }))}
            />
          </div>
        ) : null}
      </Card>

      {error ? (
        <div className="error-state" role="alert">
          <strong>Something went wrong</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div className="notice-state" role="status">
          <strong>{notice}</strong>
        </div>
      ) : null}

      <div className="form-actions sticky-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={!valid || isSaving}
          onClick={() => void save()}
        >
          {isSaving
            ? 'Saving…'
            : saved
              ? `Save changes (v${saved.version + 1})`
              : 'Save configuration'}
        </button>
        <button
          className="button"
          type="button"
          disabled={!saved}
          onClick={() => void continueToProcessing()}
        >
          Continue to processing
        </button>
        {!valid ? (
          <span className="muted small">Resolve the blocking issues above to save.</span>
        ) : null}
      </div>
    </div>
  );
}

interface MappingCardProps {
  role: ColumnRoleDefinition;
  datasetId: string | undefined;
  datasetName: string | null;
  columns: DatasetColumn[];
  singleValue: string;
  multiValues: string[];
  confirmed: boolean;
  issues: ConfigurationIssue[];
  loading: boolean;
  onSingleChange: (column: string) => void;
  onMultiChange: (column: string, checked: boolean) => void;
  onConfirmedChange: (value: boolean) => void;
}

function MappingCard({
  role,
  datasetId,
  datasetName,
  columns,
  singleValue,
  multiValues,
  confirmed,
  issues,
  loading,
  onSingleChange,
  onMultiChange,
  onConfirmedChange,
}: MappingCardProps) {
  const needsConfirmation = roleNeedsConfirmation(issues, role.key);
  const selectedColumn = columns.find((column) => column.name === singleValue) ?? null;

  return (
    <div className="mapping-card">
      <div className="mapping-header">
        <div>
          <strong>{role.required ? `${role.label} *` : role.label}</strong>
          <p className="muted small">{role.description}</p>
        </div>
        <Badge tone={role.semantic === 'identifier' ? 'info' : 'neutral'}>{role.semantic}</Badge>
      </div>

      {!datasetId ? (
        <p className="muted small">
          Assign the “{role.datasetRole}” dataset above to map this column.
        </p>
      ) : loading ? (
        <LoadingState label="Reading columns…" />
      ) : role.multiple ? (
        <div className="column-checklist">
          {columns.map((column) => (
            <label key={column.name} className="checkbox-field">
              <input
                type="checkbox"
                checked={multiValues.includes(column.name)}
                onChange={(event) => onMultiChange(column.name, event.target.checked)}
              />
              <span>{columnOptionLabel(column)}</span>
            </label>
          ))}
        </div>
      ) : (
        <>
          <Field label={`Column in ${datasetName ?? 'dataset'}`}>
            <select
              className="input"
              value={singleValue}
              onChange={(event) => onSingleChange(event.target.value)}
            >
              <option value="">— choose a column —</option>
              {columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {columnOptionLabel(column)}
                </option>
              ))}
            </select>
          </Field>
          {selectedColumn ? (
            <p className="muted small">
              Sample values: {selectedColumn.sampleValues.slice(0, 3).join(' · ') || '—'}
            </p>
          ) : null}
        </>
      )}

      {needsConfirmation ? (
        <label className="checkbox-field confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => onConfirmedChange(event.target.checked)}
          />
          <span>I checked this column and want to use it anyway.</span>
        </label>
      ) : null}
    </div>
  );
}
