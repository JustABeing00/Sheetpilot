import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowConfigField } from '@sheetpilot/core';
import { useCreateRun, useUploadFile, useWorkflow, useWorkflows } from '../api/hooks.js';
import { Card, ErrorState, Field, LoadingState, PageHeader } from '../components/ui.js';

function buildConfig(
  fields: WorkflowConfigField[],
  raw: Record<string, string>,
): Record<string, string | number | boolean> {
  const config: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const value = raw[field.key];
    if (value === undefined || value === '') {
      continue;
    }
    if (field.kind === 'number') {
      config[field.key] = Number(value);
    } else if (field.kind === 'boolean') {
      config[field.key] = value === 'true';
    } else {
      config[field.key] = value;
    }
  }
  return config;
}

export function NewRunPage() {
  const navigate = useNavigate();
  const workflows = useWorkflows();
  const [slug, setSlug] = useState('');
  const workflow = useWorkflow(slug.length > 0 ? slug : undefined);
  const upload = useUploadFile();
  const createRun = useCreateRun();

  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [eventsFile, setEventsFile] = useState<File | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const first = workflows.data?.items[0];
    if (slug.length === 0 && first) {
      setSlug(first.slug);
    }
  }, [workflows.data, slug]);

  const fields = useMemo(() => workflow.data?.configFields ?? [], [workflow.data]);

  const busy = upload.isPending || createRun.isPending;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (slug.length === 0) {
      setError('Select a workflow first.');
      return;
    }
    if (!primaryFile || !eventsFile) {
      setError('Both the primary file and the events file are required.');
      return;
    }

    try {
      const primary = await upload.mutateAsync({ kind: 'primary', file: primaryFile });
      const events = await upload.mutateAsync({ kind: 'events', file: eventsFile });
      const run = await createRun.mutateAsync({
        workflowSlug: slug,
        primaryFileId: primary.id,
        eventsFileId: events.id,
        config: buildConfig(fields, overrides),
      });
      void navigate(`/runs/${run.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to start the run.');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="New run"
        description="Upload the daily files, optionally adjust the column mapping, then review the exceptions."
      />

      <form className="run-form" onSubmit={(event) => void submit(event)}>
        <Card title="1. Workflow">
          {workflows.isLoading ? <LoadingState label="Loading workflows…" /> : null}
          {workflows.isError ? (
            <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />
          ) : null}
          {workflows.isSuccess ? (
            <Field label="Workflow definition" hint={workflow.data?.description}>
              <select
                className="input"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                  setOverrides({});
                }}
              >
                {workflows.data.items.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name} (v{item.version})
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </Card>

        <Card
          title="2. Input files"
          subtitle="CSV or XLSX. The files are validated and previewed on upload."
        >
          <div className="field-grid">
            <Field label="Primary file" hint="Accounts and the columns that need to be filled in.">
              <input
                className="input"
                type="file"
                accept=".csv,.xlsx,.xlsm,.txt"
                onChange={(event) => setPrimaryFile(event.target.files?.[0] ?? null)}
              />
            </Field>
            <Field
              label="Events file"
              hint="Fault records; the same account may appear many times."
            >
              <input
                className="input"
                type="file"
                accept=".csv,.xlsx,.xlsm,.txt"
                onChange={(event) => setEventsFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="3. Mapping and options"
          subtitle="Defaults match the sample files. Change them when the column headers differ."
        >
          {workflow.isLoading ? <LoadingState label="Loading configuration…" /> : null}
          <div className="field-grid">
            {fields.map((field) => (
              <Field key={field.key} label={field.label} hint={field.description}>
                {field.kind === 'boolean' ? (
                  <select
                    className="input"
                    value={overrides[field.key] ?? String(field.defaultValue ?? false)}
                    onChange={(event) =>
                      setOverrides((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    className="input"
                    type={field.kind === 'number' ? 'number' : 'text'}
                    step={field.kind === 'number' ? '0.01' : undefined}
                    placeholder={field.defaultValue === null ? '' : String(field.defaultValue)}
                    value={overrides[field.key] ?? String(field.defaultValue ?? '')}
                    onChange={(event) =>
                      setOverrides((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                )}
              </Field>
            ))}
          </div>
        </Card>

        {error ? (
          <div className="error-state" role="alert">
            <strong>Could not start the run</strong>
            <p>{error}</p>
          </div>
        ) : null}

        <div className="form-actions">
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Uploading and starting…' : 'Start run'}
          </button>
          <span className="muted small">
            The run executes in the background; the run page refreshes automatically.
          </span>
        </div>
      </form>
    </div>
  );
}
