import { Link } from 'react-router-dom';
import { useRuns } from '../api/hooks.js';
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui.js';
import { WorkflowProgress } from '../components/WorkflowProgress.js';
import { runStatusLabel, statusTone } from '../lib/status.js';
import { formatDateTime, formatPercent } from '../lib/format.js';

export function RunsPage() {
  const runs = useRuns();

  return (
    <div className="page">
      <WorkflowProgress current="processing" />
      <PageHeader
        title="Processing runs"
        description="Each run matches your files, picks the latest event per record, applies the rules and produces the report."
        actions={
          <Link className="button button-primary" to="/setup">
            Start a workflow
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
            description="Set up a workflow to generate a completed report and a review queue."
            action={
              <Link className="button button-primary" to="/setup">
                Set up a workflow
              </Link>
            }
          />
        ) : null}
        {runs.isSuccess && runs.data.items.length > 0 ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Records</th>
                  <th>Auto-resolved</th>
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
                      <Badge tone={statusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
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
          </div>
        ) : null}
      </Card>
    </div>
  );
}
