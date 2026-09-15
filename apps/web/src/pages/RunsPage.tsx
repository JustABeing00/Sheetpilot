import { Link } from 'react-router-dom';
import { useRuns } from '../api/hooks.js';
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui.js';
import { statusTone } from '../lib/status.js';
import { formatDateTime, formatPercent } from '../lib/format.js';

export function RunsPage() {
  const runs = useRuns();

  return (
    <div className="page">
      <PageHeader
        title="Runs"
        description="Each run matches the files, selects the latest record per entity, applies rules and produces artifacts."
        actions={
          <Link className="button button-primary" to="/runs/new">
            New run
          </Link>
        }
      />

      <Card>
        {runs.isLoading ? <LoadingState label="Loading runs…" /> : null}
        {runs.isError ? (
          <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
        ) : null}
        {runs.isSuccess && runs.data.items.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Start a run to generate a completed output file and a review queue."
            action={
              <Link className="button button-primary" to="/runs/new">
                New run
              </Link>
            }
          />
        ) : null}
        {runs.isSuccess && runs.data.items.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Workflow</th>
                <th>Status</th>
                <th>Accounts</th>
                <th>Auto-approved</th>
                <th>Review</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.items.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link className="link mono" to={`/runs/${run.id}`}>
                      {run.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <div>{run.workflowName}</div>
                    <div className="muted small">
                      {run.primaryFileName ?? 'primary'} → {run.eventsFileName ?? 'events'}
                    </div>
                  </td>
                  <td>
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                  </td>
                  <td>{run.stats['accounts'] ?? '—'}</td>
                  <td>{formatPercent(run.stats['autoApprovalRate'])}</td>
                  <td>
                    {run.openReviewItemCount} open / {run.reviewItemCount}
                  </td>
                  <td>{formatDateTime(run.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
