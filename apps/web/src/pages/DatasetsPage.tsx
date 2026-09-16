import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { useDatasets, useUploadDataset } from '../api/hooks.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
} from '../components/ui.js';
import { formatBytes, formatDateTime } from '../lib/format.js';

export function DatasetsPage() {
  const navigate = useNavigate();
  const datasets = useDatasets();
  const upload = useUploadDataset();

  const [kind, setKind] = useState('generic');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError('Choose a .csv, .xlsx or .xlsm file first.');
      return;
    }
    try {
      const dataset = await upload.mutateAsync({ kind, file });
      void navigate(`/datasets/${dataset.id}`);
    } catch (uploadError) {
      setError(
        uploadError instanceof ApiError
          ? `${uploadError.message} (${uploadError.code})`
          : uploadError instanceof Error
            ? uploadError.message
            : 'The upload failed.',
      );
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Datasets"
        description="Upload an Excel or CSV file and immediately see what the system detected: sheets, columns, types, row counts and validation warnings."
      />

      <form className="run-form" onSubmit={(event) => void submit(event)}>
        <Card
          title="Upload a file"
          subtitle="Supported: .csv, .xlsx, .xlsm. Files are validated, stored under an internal id and never executed."
        >
          <div className="field-grid">
            <Field label="File role" hint="Used later when starting a workflow run.">
              <select
                className="input"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="generic">Generic</option>
                <option value="primary">Primary</option>
                <option value="events">Events</option>
              </select>
            </Field>
            <Field
              label="File"
              hint="Files are read with a bounded scan; rows are paged on demand."
            >
              <input
                className="input"
                type="file"
                accept=".csv,.xlsx,.xlsm,.tsv,.txt"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          </div>

          {error ? (
            <div className="error-state" role="alert">
              <strong>Could not ingest the file</strong>
              <p>{error}</p>
            </div>
          ) : null}

          <div className="form-actions">
            <button className="button button-primary" type="submit" disabled={upload.isPending}>
              {upload.isPending ? 'Uploading and inspecting…' : 'Upload and inspect'}
            </button>
            <span className="muted small">
              The dataset page opens as soon as inspection completes.
            </span>
          </div>
        </Card>
      </form>

      <Card title="Ingested datasets">
        {datasets.isLoading ? <LoadingState label="Loading datasets…" /> : null}
        {datasets.isError ? (
          <ErrorState error={datasets.error} onRetry={() => void datasets.refetch()} />
        ) : null}
        {datasets.isSuccess && datasets.data.items.length === 0 ? (
          <EmptyState
            title="No datasets yet"
            description="Upload a CSV or XLSX file above to inspect its structure."
          />
        ) : null}
        {datasets.isSuccess && datasets.data.items.length > 0 ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Original file</th>
                  <th>Dataset ID</th>
                  <th>Format</th>
                  <th>Rows</th>
                  <th>Columns</th>
                  <th>Warnings</th>
                  <th>Inspected</th>
                </tr>
              </thead>
              <tbody>
                {datasets.data.items.map((dataset) => (
                  <tr key={dataset.id}>
                    <td>
                      <Link to={`/datasets/${dataset.id}`}>{dataset.originalName}</Link>
                      <div className="muted small">{formatBytes(dataset.sizeBytes)}</div>
                    </td>
                    <td className="mono small">{dataset.id}</td>
                    <td>
                      <Badge tone="info">{dataset.format}</Badge>
                    </td>
                    <td>
                      {dataset.rowCount.toLocaleString()}
                      {dataset.rowCountExact ? '' : '+'}
                    </td>
                    <td>{dataset.columnCount}</td>
                    <td>
                      {dataset.warningCount > 0 ? (
                        <Badge tone="warning">{dataset.warningCount}</Badge>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td className="small">{formatDateTime(dataset.inspectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
