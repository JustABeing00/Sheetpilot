import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDataset, useDatasetAnalysis, useDatasetRows } from '../api/hooks.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingState,
  PageHeader,
  StatCard,
} from '../components/ui.js';
import { columnFlags, columnTypeTone, formatRatio, warningTone } from '../lib/datasets.js';
import { formatBytes, formatDateTime } from '../lib/format.js';

const ROWS_PER_PAGE = 25;

export function DatasetDetailPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const dataset = useDataset(datasetId);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const activeSheet = selectedSheet ?? dataset.data?.sheetName ?? null;
  const analysis = useDatasetAnalysis(datasetId, activeSheet);
  const rows = useDatasetRows(datasetId, activeSheet, ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  if (dataset.isLoading) {
    return <LoadingState label="Loading dataset…" />;
  }
  if (dataset.isError) {
    return <ErrorState error={dataset.error} onRetry={() => void dataset.refetch()} />;
  }
  if (!dataset.data) {
    return <EmptyState title="Dataset not found" />;
  }

  const profile = dataset.data;
  const details = analysis.data?.analysis;
  const warnings = details?.warnings ?? profile.warnings;
  const columns = details?.columns ?? profile.columns;
  const rowCount = details?.rowCount ?? profile.rowCount;

  return (
    <div className="page">
      <PageHeader
        title={profile.originalName}
        description={`Internal dataset ${profile.id}`}
        actions={
          <div className="page-actions">
            <Badge tone="info">{profile.format.toUpperCase()}</Badge>
            <Badge tone="neutral">{profile.kind}</Badge>
          </div>
        }
      />

      <div className="stat-grid">
        <StatCard
          label="Rows detected"
          value={`${rowCount.toLocaleString()}${(details?.rowCountExact ?? profile.rowCountExact) ? '' : '+'}`}
          hint={
            (details?.truncated ?? profile.truncated)
              ? `Scan limited to ${profile.scanLimit.toLocaleString()} rows`
              : 'Full row count'
          }
        />
        <StatCard label="Columns" value={columns.length} hint="Detected from the header row" />
        <StatCard label="Size" value={formatBytes(profile.sizeBytes)} hint={profile.mimeType} />
        <StatCard
          label="Sheets"
          value={profile.sheetNames.length > 0 ? profile.sheetNames.length : '—'}
          hint={activeSheet ?? 'single table'}
        />
        <StatCard
          label="Warnings"
          value={warnings.length}
          hint={warnings.length === 0 ? 'No issues detected' : 'See validation warnings'}
        />
      </div>

      <div className="two-column">
        <Card
          title="Detected structure"
          subtitle="Original filename and internal id are kept separate."
        >
          <KeyValue
            items={[
              { label: 'Original filename', value: profile.originalName },
              { label: 'Internal dataset ID', value: <span className="mono">{profile.id}</span> },
              { label: 'File ID', value: <span className="mono">{profile.fileId}</span> },
              {
                label: 'Checksum (sha256)',
                value: <span className="mono small">{profile.checksum.slice(0, 16)}…</span>,
              },
              { label: 'Inspected at', value: formatDateTime(profile.inspectedAt) },
              { label: 'Sheet', value: activeSheet ?? '—' },
            ]}
          />
        </Card>

        <Card
          title="Validation warnings"
          subtitle="Potential problems to review before mapping columns."
        >
          {warnings.length === 0 ? (
            <EmptyState
              title="No warnings"
              description="The dataset passed all structural checks."
            />
          ) : (
            <ul className="warning-list">
              {warnings.map((warning, index) => (
                <li key={`${warning.code}-${warning.column ?? index}`} className="warning-item">
                  <Badge tone={warningTone(warning.severity)}>{warning.code}</Badge>
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Columns"
        subtitle="Inferred types, emptiness, uniqueness and likely date/identifier columns."
        actions={
          profile.sheetNames.length > 1 ? (
            <label className="inline-field">
              <span className="field-label">Sheet</span>
              <select
                className="input"
                value={activeSheet ?? ''}
                onChange={(event) => {
                  setSelectedSheet(event.target.value);
                  setPage(0);
                }}
              >
                {profile.sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null
        }
      >
        {analysis.isLoading ? <LoadingState label="Analyzing columns…" /> : null}
        {columns.length === 0 ? (
          <EmptyState title="No columns detected" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Empty</th>
                  <th>Unique</th>
                  <th>Sample values</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((column) => (
                  <tr key={`${column.index}-${column.name}`}>
                    <td className="muted">{column.index + 1}</td>
                    <td className="mono">{column.name}</td>
                    <td>
                      <Badge tone={columnTypeTone(column.type)}>{column.type}</Badge>
                    </td>
                    <td>
                      {column.emptyCount} ({formatRatio(column.emptyRatio)})
                    </td>
                    <td>
                      {column.uniqueCount}{' '}
                      <span className="muted small">{formatRatio(column.uniqueRatio)}</span>
                    </td>
                    <td className="small">
                      {column.sampleValues.length > 0 ? column.sampleValues.join(' · ') : '—'}
                    </td>
                    <td>
                      <span className="flag-row">
                        {columnFlags(column).map((flag) => (
                          <Badge key={flag.label} tone={flag.tone}>
                            {flag.label}
                          </Badge>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Row preview"
        subtitle="Rows are paged from storage; the full dataset is never loaded into the browser."
      >
        {rows.isLoading ? <LoadingState label="Loading rows…" /> : null}
        {rows.isError ? (
          <ErrorState error={rows.error} onRetry={() => void rows.refetch()} />
        ) : null}
        {rows.data && rows.data.items.length === 0 && page === 0 ? (
          <EmptyState title="No rows to preview" />
        ) : null}
        {rows.data && rows.data.items.length > 0 ? (
          <>
            <div className="table-scroll">
              <table className="table preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    {rows.data.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.data.items.map((row, rowIndex) => (
                    <tr key={`${page}-${rowIndex}`}>
                      <td className="muted">{page * ROWS_PER_PAGE + rowIndex + 1}</td>
                      {rows.data.columns.map((column) => (
                        <td key={column}>
                          {row[column] === '' ? <span className="muted">—</span> : row[column]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button
                className="button"
                type="button"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Previous
              </button>
              <span className="muted small">
                Rows {page * ROWS_PER_PAGE + 1}–{page * ROWS_PER_PAGE + rows.data.items.length}
                {rows.data.total !== null ? ` of ${rows.data.total.toLocaleString()}` : ''}
              </span>
              <button
                className="button"
                type="button"
                disabled={!rows.data.hasMore}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </>
        ) : null}
      </Card>
    </div>
  );
}
