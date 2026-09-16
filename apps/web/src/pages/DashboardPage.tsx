import { Link } from 'react-router-dom';
import { useDatasets, useHealth, useMeta, useReviewQueue, useRuns, useSavedWorkflows, useWorkflows } from '../api/hooks.js';
import { SavedWorkflowsTable } from '../components/SavedWorkflowsTable.js';
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatCard } from '../components/ui.js';
import { runStatusLabel, statusTone } from '../lib/status.js';
import { PIPELINE_STAGES } from '../lib/pipeline.js';
import { formatDateTime, formatPercent } from '../lib/format.js';

export function DashboardPage() {
  const meta = useMeta();
  const health = useHealth();
  const workflows = useWorkflows();
  const runs = useRuns();
  const datasets = useDatasets();
  const reviewQueue = useReviewQueue('needs_review');
  const savedWorkflows = useSavedWorkflows();

  const recentRuns = runs.data?.items.slice(0, 6) ?? [];
  const latestRun = recentRuns[0];
  const openReview = reviewQueue.data?.openCount ?? 0;
  const saved = savedWorkflows.data?.items ?? [];
  const firstSaved = saved[0];

  // The single most useful next action, based on what already exists.
  const nextAction = (() => {
    if ((datasets.data?.items.length ?? 0) === 0) {
      return {
        label: 'Step 1 · Upload your files',
        description: 'Add the spreadsheet(s) this workflow reads, then map the columns.',
        to: '/datasets',
      };
    }
    if (!latestRun) {
      return {
        label: 'Step 2 · Set up and process',
        description: 'Connect your files, confirm the columns, and start processing.',
        to: '/setup',
      };
    }
    if (openReview > 0) {
      return {
        label: `Step 4 · Review ${openReview} open ${openReview === 1 ? 'case' : 'cases'}`,
        description: 'A person decides the unusual records before the report is final.',
        to: '/review',
      };
    }
    return {
      label: 'Step 5 · Download the report',
      description: 'Everything is resolved. Open the latest run and download the Excel file.',
      to: `/runs/${latestRun.id}`,
    };
  })();

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        description="Recurring spreadsheet workflows, deterministic classification and human review in one place."
        actions={
          firstSaved ? (
            <Link className="button button-primary" to={`/saved-workflows/${firstSaved.id}/run`}>
              Run a saved workflow again
            </Link>
          ) : (
            <Link className="button button-primary" to="/setup">
              Start a workflow
            </Link>
          )
        }
      />

      <Card
        title="Your saved workflows"
        subtitle="Run a saved workflow again on new files, or open one to see what it remembers."
        actions={
          <>
            {saved.length > 0 ? (
              <Link className="link" to="/saved-workflows">
                View all
              </Link>
            ) : null}
            <Link className="button button-small" to="/setup">
              New
            </Link>
          </>
        }
      >
        {savedWorkflows.isLoading ? <LoadingState label="Loading saved workflows…" /> : null}
        {savedWorkflows.isError ? (
          <ErrorState error={savedWorkflows.error} onRetry={() => void savedWorkflows.refetch()} />
        ) : null}
        {savedWorkflows.isSuccess && saved.length === 0 ? (
          <EmptyState
            title="No saved workflows yet"
            description="Set up a workflow once; next month you just attach the new files and run it again."
            action={
              <Link className="button button-primary" to="/setup">
                Create your first saved workflow
              </Link>
            }
          />
        ) : null}
        {saved.length > 0 ? <SavedWorkflowsTable items={saved.slice(0, 5)} /> : null}
      </Card>

      <Card title="Your next step" subtitle={nextAction.description}>
        <div className="next-step">
          <strong>{nextAction.label}</strong>
          <Link className="button button-primary" to={nextAction.to}>
            Continue
          </Link>
        </div>
        <ol className="journey-list">
          {PIPELINE_STAGES.map((stage, index) => (
            <li key={stage.key}>
              <Link className="link" to={stage.to}>
                <span className="journey-index">{index + 1}</span>
                <span>
                  <strong>{stage.label}</strong>
                  <span className="muted small"> — {stage.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </Card>

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
                      <Badge tone={statusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
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
