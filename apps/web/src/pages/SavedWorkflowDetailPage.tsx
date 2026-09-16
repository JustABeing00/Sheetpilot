import { Link, useParams } from 'react-router-dom';
import { useDatasetDetails, useSavedWorkflow, useWorkflow } from '../api/hooks.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
} from '../components/ui.js';
import { formatDateTime } from '../lib/format.js';
import { exportStatusLabel, exportStatusTone, runStatusLabel, statusTone } from '../lib/status.js';

function describeOptionValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'on' : 'off';
  }
  return String(value);
}

export function SavedWorkflowDetailPage() {
  const { savedWorkflowId } = useParams<{ savedWorkflowId: string }>();
  const detail = useSavedWorkflow(savedWorkflowId);
  const workflow = useWorkflow(detail.data?.workflowSlug);

  const assignedIds = detail.data?.configuration.assignments.map((entry) => entry.datasetId) ?? [];
  const datasetDetails = useDatasetDetails(assignedIds);

  const datasetNames = new Map(
    datasetDetails
      .filter((query) => query.data)
      .map((query) => [query.data!.id, query.data!.originalName] as const),
  );

  if (detail.isLoading) {
    return <LoadingState label="Loading saved workflow…" />;
  }
  if (detail.isError) {
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  if (!detail.data) {
    return <EmptyState title="Saved workflow not found" />;
  }

  const saved = detail.data;
  const configuration = saved.configuration;
  const columnRoleLabels = new Map(
    (workflow.data?.configuration.columnRoles ?? []).map((role) => [role.key, role.label] as const),
  );
  const datasetRoleLabels = new Map(
    (workflow.data?.configuration.datasetRoles ?? []).map(
      (role) => [role.key, role.label] as const,
    ),
  );
  const optionLabels = new Map(
    (workflow.data?.configuration.options ?? []).map(
      (option) => [option.key, option.label] as const,
    ),
  );

  return (
    <div className="page">
      <PageHeader
        title={saved.name}
        description={saved.description || `${saved.workflowName} · a reusable, versioned setup.`}
        actions={
          <>
            <Link className="button button-primary" to={`/saved-workflows/${saved.id}/run`}>
              Run again
            </Link>
            <Link className="button" to={`/setup/${saved.id}`}>
              Edit setup
            </Link>
            <Link className="button" to="/rules">
              Rules
            </Link>
          </>
        }
      />

      <div className="stat-grid">
        <StatCard
          label="Setup version"
          value={`v${saved.configurationVersion}`}
          hint="frozen per run"
        />
        <StatCard
          label="Rules"
          value={saved.ruleSet ? `${saved.ruleSet.ruleCount}` : '—'}
          hint={
            saved.ruleSet ? `${saved.ruleSet.name} · v${saved.ruleSet.version}` : 'no active set'
          }
        />
        <StatCard label="Files" value={saved.datasetCount} hint="dataset roles attached" />
        <StatCard label="Mapped columns" value={saved.mappingCount} hint="remembered by name" />
        <StatCard label="Runs" value={saved.runCount} hint="kept with full history" />
      </div>

      <div className="two-column">
        <Card title="What this workflow remembers" subtitle="Everything needed to run it again.">
          <h3 className="subsection-title">Files and roles</h3>
          <ul className="detail-list">
            {configuration.assignments.map((assignment) => (
              <li key={assignment.role}>
                <strong>{datasetRoleLabels.get(assignment.role) ?? assignment.role}</strong>
                <span className="muted">
                  {' '}
                  → {datasetNames.get(assignment.datasetId) ?? assignment.datasetId}
                </span>
              </li>
            ))}
            {configuration.assignments.length === 0 ? (
              <li className="muted">No files attached.</li>
            ) : null}
          </ul>

          <h3 className="subsection-title">Column mapping</h3>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Role</th>
                <th>Column</th>
              </tr>
            </thead>
            <tbody>
              {configuration.mappings.map((mapping, index) => (
                <tr key={`${mapping.role}-${mapping.column}-${index}`}>
                  <td>{columnRoleLabels.get(mapping.role) ?? mapping.role}</td>
                  <td className="mono small">{mapping.column}</td>
                </tr>
              ))}
              {configuration.mappings.length === 0 ? (
                <tr>
                  <td colSpan={2} className="muted">
                    No columns mapped yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <h3 className="subsection-title">Matching &amp; latest-record logic</h3>
          <p className="muted small">
            {saved.workflowName} joins each primary record to all of its events, picks the latest
            event deterministically and flags ties. These steps are fixed by the workflow type:
          </p>
          <ol className="journey-list compact">
            {(workflow.data?.steps ?? []).map((step, index) => (
              <li key={step.id}>
                <span className="journey-index">{index + 1}</span>
                <span>{step.name}</span>
              </li>
            ))}
          </ol>

          <h3 className="subsection-title">Output &amp; review behavior</h3>
          {Object.keys(configuration.options).length === 0 ? (
            <p className="muted small">Using the workflow defaults for output and review.</p>
          ) : (
            <dl className="key-value">
              {Object.entries(configuration.options).map(([key, value]) => (
                <div key={key}>
                  <dt>{optionLabels.get(key) ?? key}</dt>
                  <dd>{describeOptionValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        <Card title="Recent runs" subtitle="Each run keeps its own frozen setup and rule versions.">
          {saved.recentRuns.length === 0 ? (
            <EmptyState
              title="No runs yet"
              description="Run the workflow to produce your first report."
              action={
                <Link className="button button-primary" to={`/saved-workflows/${saved.id}/run`}>
                  Run again
                </Link>
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Records</th>
                  <th>Review</th>
                  <th>Report</th>
                </tr>
              </thead>
              <tbody>
                {saved.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link className="link mono" to={`/runs/${run.id}`}>
                        {run.id.slice(0, 8)}
                      </Link>
                      <div className="muted small">{formatDateTime(run.createdAt)}</div>
                    </td>
                    <td>
                      <Badge tone={statusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
                    </td>
                    <td>{run.recordsProcessed}</td>
                    <td>
                      {run.reviewItemCount === 0 ? (
                        <span className="muted">none</span>
                      ) : (
                        <Link className="link" to={`/review?runId=${run.id}`}>
                          {run.openReviewItemCount} open / {run.reviewItemCount}
                        </Link>
                      )}
                    </td>
                    <td>
                      <Badge tone={exportStatusTone(run.exportStatus)}>
                        {exportStatusLabel(run.exportStatus)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
