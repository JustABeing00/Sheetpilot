import { useParams } from 'react-router-dom';
import { useRun, useRunArtifacts, useRunDecisions, useRunReviewItems } from '../api/hooks.js';
import { ReviewItemCard } from '../components/ReviewItemCard.js';
import {
  Badge,
  Card,
  ErrorState,
  KeyValue,
  LoadingState,
  PageHeader,
  StatCard,
} from '../components/ui.js';
import { statusTone } from '../lib/status.js';
import {
  formatBytes,
  formatCellValue,
  formatDateTime,
  formatDuration,
  formatPercent,
  humanizeToken,
} from '../lib/format.js';
import { apiDownloadUrl } from '../api/client.js';

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const run = useRun(runId);
  const artifacts = useRunArtifacts(runId);
  const reviewItems = useRunReviewItems(runId);
  const decisions = useRunDecisions(runId);

  if (run.isLoading) {
    return (
      <div className="page">
        <LoadingState label="Loading run…" />
      </div>
    );
  }

  if (run.isError || !run.data) {
    return (
      <div className="page">
        <ErrorState error={run.error} onRetry={() => void run.refetch()} />
      </div>
    );
  }

  const detail = run.data;
  const duration =
    detail.startedAt && detail.finishedAt
      ? new Date(detail.finishedAt).getTime() - new Date(detail.startedAt).getTime()
      : null;

  return (
    <div className="page">
      <PageHeader
        title={`Run ${detail.id.slice(0, 8)}`}
        description={`${detail.workflowName} v${detail.workflowVersion}`}
        actions={<Badge tone={statusTone(detail.status)}>{detail.status}</Badge>}
      />

      {detail.error ? (
        <div className="error-state" role="alert">
          <strong>Run failed</strong>
          <p>{detail.error}</p>
        </div>
      ) : null}

      <Card title="Overview">
        <KeyValue
          items={[
            { label: 'Primary file', value: detail.primaryFileName ?? detail.primaryFileId },
            { label: 'Events file', value: detail.eventsFileName ?? detail.eventsFileId },
            { label: 'Created', value: formatDateTime(detail.createdAt) },
            { label: 'Started', value: formatDateTime(detail.startedAt) },
            { label: 'Finished', value: formatDateTime(detail.finishedAt) },
            { label: 'Duration', value: duration === null ? '—' : formatDuration(duration) },
          ]}
        />
      </Card>

      <div className="stat-grid">
        <StatCard label="Accounts" value={detail.stats['accounts'] ?? '—'} />
        <StatCard label="Output rows" value={detail.stats['outputRows'] ?? '—'} />
        <StatCard label="Fault events" value={detail.stats['eventRows'] ?? '—'} />
        <StatCard label="Rule match rate" value={formatPercent(detail.stats['ruleMatchRate'])} />
        <StatCard label="Auto-approved" value={detail.stats['autoApprovedAccounts'] ?? '—'} />
        <StatCard label="Needs review" value={detail.stats['reviewAccounts'] ?? '—'} />
        <StatCard label="Orphan events" value={detail.stats['orphanEventAccounts'] ?? '—'} />
      </div>

      <Card title="Steps" subtitle="Pipeline stages executed with their metrics">
        <ol className="step-list">
          {detail.steps.map((step) => (
            <li key={step.id}>
              <div className="step-header">
                <span className="step-name">{step.name}</span>
                <Badge tone={statusTone(step.status)}>{step.status}</Badge>
                <span className="muted small">{formatDuration(step.durationMs)}</span>
              </div>
              {Object.keys(step.metrics).length > 0 ? (
                <div className="step-metrics">
                  {Object.entries(step.metrics).map(([key, value]) => (
                    <span key={key} className="metric-chip">
                      {humanizeToken(key)}: <strong>{value}</strong>
                    </span>
                  ))}
                </div>
              ) : null}
              {step.error ? <p className="error-text">{step.error}</p> : null}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Output artifacts" subtitle="Generated files available for download">
        {artifacts.isLoading ? <LoadingState label="Loading artifacts…" /> : null}
        {artifacts.isError ? (
          <ErrorState error={artifacts.error} onRetry={() => void artifacts.refetch()} />
        ) : null}
        {artifacts.isSuccess && artifacts.data.items.length === 0 ? (
          <p className="muted">No artifacts were produced.</p>
        ) : null}
        {artifacts.isSuccess && artifacts.data.items.length > 0 ? (
          <ul className="artifact-list">
            {artifacts.data.items.map((artifact) => (
              <li key={artifact.id}>
                <div>
                  <strong>{artifact.fileName}</strong>
                  <span className="muted small">
                    {humanizeToken(artifact.kind)} · {artifact.format.toUpperCase()} ·{' '}
                    {formatBytes(artifact.sizeBytes)}
                  </span>
                </div>
                <a className="button" href={apiDownloadUrl(artifact.downloadUrl)} download>
                  Download
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card
        title="Review queue"
        subtitle="Only the unusual accounts require a human decision"
        actions={
          <span className="muted small">
            {reviewItems.data?.openCount ?? 0} open / {reviewItems.data?.items.length ?? 0} total
          </span>
        }
      >
        {reviewItems.isLoading ? <LoadingState label="Loading review items…" /> : null}
        {reviewItems.isError ? (
          <ErrorState error={reviewItems.error} onRetry={() => void reviewItems.refetch()} />
        ) : null}
        {reviewItems.isSuccess && reviewItems.data.items.length === 0 ? (
          <p className="muted">
            Nothing to review — every account was classified deterministically.
          </p>
        ) : null}
        <div className="review-list">
          {reviewItems.data?.items.map((item) => (
            <ReviewItemCard key={item.id} item={item} />
          ))}
        </div>
      </Card>

      <Card
        title="Decision log"
        subtitle="Every account keeps the rule, confidence and evidence behind its output"
      >
        {decisions.isLoading ? <LoadingState label="Loading decisions…" /> : null}
        {decisions.isError ? (
          <ErrorState error={decisions.error} onRetry={() => void decisions.refetch()} />
        ) : null}
        {decisions.isSuccess ? (
          <table className="table">
            <thead>
              <tr>
                <th>Entity</th>
                <th>Rule</th>
                <th>Confidence</th>
                <th>Review reasons</th>
                <th>Root cause</th>
              </tr>
            </thead>
            <tbody>
              {decisions.data.items.map((decision) => (
                <tr key={decision.id}>
                  <td className="mono">{decision.entityKey}</td>
                  <td className="mono small">{decision.matchedRuleIds.join(', ') || '—'}</td>
                  <td>{Math.round(decision.confidence * 100)}%</td>
                  <td className="small">
                    {decision.reviewReasons.length > 0
                      ? decision.reviewReasons.map(humanizeToken).join(', ')
                      : '—'}
                  </td>
                  <td>{formatCellValue(decision.outputValues['RootCause'])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
