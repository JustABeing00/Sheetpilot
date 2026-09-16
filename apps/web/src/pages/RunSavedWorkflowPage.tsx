import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import {
  useDatasets,
  usePrepareSavedWorkflowRun,
  useRunSavedWorkflow,
  useSavedWorkflow,
  useUploadDataset,
  useWorkflow,
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
import { WorkflowProgress } from '../components/WorkflowProgress.js';
import { issueTone } from '../lib/configurations.js';

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : 'The request failed.';
}

function kindForRole(role: string): 'primary' | 'events' | 'generic' {
  return role === 'primary' || role === 'events' ? role : 'generic';
}

export function RunSavedWorkflowPage() {
  const { savedWorkflowId } = useParams<{ savedWorkflowId: string }>();
  const navigate = useNavigate();

  const detail = useSavedWorkflow(savedWorkflowId);
  const workflow = useWorkflow(detail.data?.workflowSlug);
  const datasets = useDatasets();
  const upload = useUploadDataset();
  const prepare = usePrepareSavedWorkflowRun();
  const runSavedWorkflow = useRunSavedWorkflow();

  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [saveVersion, setSaveVersion] = useState(false);
  const [uploadingRole, setUploadingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const datasetRoles = useMemo(
    () => workflow.data?.configuration.datasetRoles ?? [],
    [workflow.data],
  );

  useEffect(() => {
    const loaded = detail.data;
    if (!loaded) {
      return;
    }
    setAssignments((current) => {
      if (Object.keys(current).length > 0) {
        return current;
      }
      const next: Record<string, string> = {};
      for (const assignment of loaded.configuration.assignments) {
        next[assignment.role] = assignment.datasetId;
      }
      return next;
    });
  }, [detail.data]);

  const assignmentList = useMemo(
    () =>
      datasetRoles.flatMap((role) => {
        const datasetId = assignments[role.key];
        return datasetId ? [{ role: role.key, datasetId, sheetName: null }] : [];
      }),
    [datasetRoles, assignments],
  );
  const assignmentKey = JSON.stringify(assignmentList);

  useEffect(() => {
    if (!savedWorkflowId || assignmentList.length === 0) {
      return;
    }
    const handle = setTimeout(() => {
      prepare.mutate({ id: savedWorkflowId, body: { assignments: assignmentList } });
    }, 350);
    return () => clearTimeout(handle);
    // assignmentKey captures the payload that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentKey, savedWorkflowId]);

  const preparedIsCurrent =
    prepare.data !== undefined &&
    JSON.stringify(prepare.variables?.body.assignments ?? []) === assignmentKey;
  const prepared = preparedIsCurrent ? prepare.data : undefined;

  const datasetById = useMemo(() => {
    const map = new Map<string, { originalName: string; rowCount: number }>();
    for (const item of datasets.data?.items ?? []) {
      map.set(item.id, { originalName: item.originalName, rowCount: item.rowCount });
    }
    return map;
  }, [datasets.data]);

  const updateAssignment = (role: string, datasetId: string) => {
    setAssignments((current) => ({ ...current, [role]: datasetId }));
  };

  const uploadForRole = async (role: string, file: File): Promise<void> => {
    setError(null);
    setUploadingRole(role);
    try {
      const dataset = await upload.mutateAsync({ kind: kindForRole(role), file });
      updateAssignment(role, dataset.id);
    } catch (uploadError) {
      setError(describeError(uploadError));
    } finally {
      setUploadingRole(null);
    }
  };

  const start = async (): Promise<void> => {
    if (!savedWorkflowId) {
      return;
    }
    setError(null);
    try {
      const run = await runSavedWorkflow.mutateAsync({
        id: savedWorkflowId,
        body: { assignments: assignmentList, saveConfiguration: saveVersion, config: {} },
      });
      void navigate(`/runs/${run.id}`);
    } catch (runError) {
      setError(describeError(runError));
    }
  };

  if (detail.isLoading) {
    return <LoadingState label="Loading saved workflow…" />;
  }
  if (detail.isError) {
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  if (!detail.data) {
    return <EmptyState title="Saved workflow not found" />;
  }
  if (workflow.isLoading) {
    return <LoadingState label="Loading saved workflow…" />;
  }
  if (workflow.isError) {
    return <ErrorState error={workflow.error} onRetry={() => void workflow.refetch()} />;
  }

  const readyRoles = datasetRoles.filter((role) => assignments[role.key]);
  const missingRoles = datasetRoles.filter((role) => role.required && !assignments[role.key]);

  return (
    <div className="page">
      <WorkflowProgress current="processing" />
      <PageHeader
        title={`Run “${detail.data.name}” again`}
        description="Attach today's files. We carry the saved mapping onto them by column name, so you only confirm what changed — then process and review the exceptions."
        actions={
          <Link className="button" to={`/saved-workflows/${detail.data.id}`}>
            View saved workflow
          </Link>
        }
      />

      <Card
        title="1 · Today's files"
        subtitle="Upload the new files or pick an existing upload for each role this workflow needs."
        actions={
          <Link className="link" to="/datasets">
            Manage uploads
          </Link>
        }
      >
        <div className="role-assignment-list">
          {datasetRoles.map((role) => {
            const selected = assignments[role.key];
            const selectedDataset = selected ? datasetById.get(selected) : undefined;
            return (
              <div key={role.key} className="role-assignment">
                <div className="role-assignment-head">
                  <div>
                    <strong>{role.required ? `${role.label} *` : role.label}</strong>
                    <p className="muted small">{role.description}</p>
                  </div>
                  {selected ? (
                    <Badge tone="success">
                      {selectedDataset?.originalName ?? 'attached'}
                      {selectedDataset ? ` · ${selectedDataset.rowCount} rows` : ''}
                    </Badge>
                  ) : (
                    <Badge tone="warning">needed</Badge>
                  )}
                </div>
                <div className="field-grid">
                  <Field label="Use an existing upload">
                    <select
                      className="input"
                      value={selected ?? ''}
                      onChange={(event) => updateAssignment(role.key, event.target.value)}
                    >
                      <option value="">— choose a file —</option>
                      {(datasets.data?.items ?? []).map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.originalName} · {dataset.rowCount} rows
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="…or upload today's file">
                    <input
                      className="input"
                      type="file"
                      accept=".csv,.xlsx,.xlsm,.txt"
                      disabled={uploadingRole === role.key}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void uploadForRole(role.key, file);
                        }
                      }}
                    />
                    {uploadingRole === role.key ? (
                      <span className="muted small">Uploading and inspecting…</span>
                    ) : null}
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="2 · Mapping check"
        subtitle="The saved column mapping is remembered by name and re-checked against today's files."
        actions={
          prepare.isPending ? (
            <Badge tone="info">checking…</Badge>
          ) : prepare.isError ? (
            <Badge tone="danger">check failed</Badge>
          ) : prepared ? (
            <Badge tone={prepared.valid ? 'success' : 'danger'}>
              {prepared.valid ? 'ready' : 'needs attention'}
            </Badge>
          ) : null
        }
      >
        {prepare.isError ? (
          <div className="error-state" role="alert">
            <strong>The mapping check failed</strong>
            <p>{describeError(prepare.error)}</p>
            <button
              type="button"
              className="button small"
              onClick={() => {
                if (savedWorkflowId && assignmentList.length > 0) {
                  prepare.mutate({ id: savedWorkflowId, body: { assignments: assignmentList } });
                }
              }}
            >
              Try again
            </button>
          </div>
        ) : missingRoles.length > 0 ? (
          <p className="muted">
            Attach a file for {missingRoles.map((role) => `“${role.label}”`).join(', ')} to
            continue.
          </p>
        ) : !prepared ? (
          <p className="muted">Checking the mapping once every file is attached…</p>
        ) : (
          <>
            {prepared.plan.dropped.length === 0 ? (
              <p className="muted small">
                All {prepared.plan.carried.length} remembered column mappings were found in the new
                files.
              </p>
            ) : (
              <ul className="warning-list">
                {prepared.plan.dropped.map((entry) => (
                  <li key={`${entry.role}-${entry.column}`} className="warning-item">
                    <Badge tone="danger">not found</Badge>
                    <span>
                      Column “{entry.column}” for “{entry.role}” is not in the attached file. Re-map
                      it in the setup.
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {prepared.issues.length > 0 ? (
              <ul className="warning-list">
                {prepared.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className="warning-item">
                    <Badge tone={issueTone(issue.severity)}>{issue.severity}</Badge>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No compatibility issues were found.</p>
            )}

            {prepared.resolvedConfig ? (
              <div className="resolved-config">
                <h3>What processing will use</h3>
                <KeyValue
                  items={Object.entries(prepared.resolvedConfig).map(([key, value]) => ({
                    label: key,
                    value: Array.isArray(value) ? value.join(', ') || '—' : String(value),
                  }))}
                />
              </div>
            ) : null}
          </>
        )}
      </Card>

      {error ? (
        <div className="error-state" role="alert">
          <strong>Could not start the run</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <div className="form-actions sticky-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={!prepared?.valid || runSavedWorkflow.isPending || readyRoles.length === 0}
          onClick={() => void start()}
        >
          {runSavedWorkflow.isPending ? 'Starting…' : 'Start processing'}
        </button>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={saveVersion}
            onChange={(event) => setSaveVersion(event.target.checked)}
          />
          <span>Update the saved workflow to point at these files</span>
        </label>
        <span className="muted small">
          The run always keeps its own frozen copy, so results are reproducible either way.
        </span>
      </div>
    </div>
  );
}
