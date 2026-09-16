import { Link } from 'react-router-dom';
import { useHealth, useMeta, useReviewQueue, useRuns, useWorkflows } from '../api/hooks.js';
import { Badge, Card, ErrorState, LoadingState, PageHeader, StatCard } from '../components/ui.js';
import { statusTone } from '../lib/status.js';
import { formatDateTime, formatPercent } from '../lib/format.js';

export function DashboardPage() {
  const meta = useMeta();
  const health = useHealth();
  const workflows = useWorkflows();
  const runs = useRuns();
  const reviewQueue = useReviewQueue('needs_review');

  const recentRuns = runs.data?.items.slice(0, 6) ?? [];
  const latestRun = recentRuns[0];

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        description="Recurring spreadsheet workflows, deterministic classification and human review in one place."
        actions={
          <Link className="button button-primary" to="/runs/new">
            New run
          </Link>
        }
      />

      <div className="stat-grid">
        <StatCard
          label="Workflows"
          value={workflows.data?.items.length ?? '—'}
          hint="registered definitions"
        />
        <StatCard label="Runs" value={runs.data?.items.length ?? '—'} hint="recent runs stored" />
        <StatCard
          label="Open review items"
          value={reviewQueue.data?.openCount ?? '—'}
          hint="unusual cases waiting for a human"
        />
        <StatCard
          label="Auto-approval (last run)"
          value={formatPercent(latestRun?.stats['autoApprovalRate'])}
          hint={latestRun ? `run ${latestRun.id.slice(0, 8)}` : 'no runs yet'}
        />
      </div>

      <div className="two-column">
        <Card
          title="Recent runs"
          subtitle="Every run keeps its step-level trace and artifacts"
          actions={
            <Link className="link" to="/runs">
              View all
            </Link>
          }
        >
          {runs.isLoading ? <LoadingState label="Loading runs…" /> : null}
          {runs.isError ? (
            <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
          ) : null}
          {runs.isSuccess && recentRuns.length === 0 ? (
            <p className="muted">
              No runs yet. Upload a primary file and an events file to generate your first output.
            </p>
          ) : null}
          {recentRuns.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Reviewed</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link className="link mono" to={`/runs/${run.id}`}>
                        {run.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{run.workflowName}</td>
                    <td>
                      <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                    </td>
                    <td>
                      {run.reviewItemCount === 0
                        ? '0'
                        : `${run.openReviewItemCount} open / ${run.reviewItemCount}`}
                    </td>
                    <td>{formatDateTime(run.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>

        <Card title="System" subtitle="Runtime configuration reported by the API">
          {meta.isLoading ? <LoadingState label="Loading capabilities…" /> : null}
          {meta.isError ? (
            <ErrorState error={meta.error} onRetry={() => void meta.refetch()} />
          ) : null}
          {meta.isSuccess ? (
            <dl className="key-value">
              <div>
                <dt>API</dt>
                <dd>
                  {health.data?.name ?? meta.data.name} v{meta.data.version}
                </dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{meta.data.environment}</dd>
              </div>
              <div>
                <dt>Repository</dt>
                <dd>{meta.data.repositoryDriver}</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>{meta.data.storageDriver}</dd>
              </div>
              <div>
                <dt>AI provider</dt>
                <dd>{meta.data.aiProvider}</dd>
              </div>
              <div>
                <dt>Uptime</dt>
                <dd>{health.data ? `${Math.round(health.data.uptimeSeconds)}s` : '—'}</dd>
              </div>
            </dl>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
