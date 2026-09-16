import { Link, useParams } from 'react-router-dom';
import {
  useRun,
  useRunArtifacts,
  useRunDecisions,
  useRunExport,
  useRunReviewItems,
  useWorkflow,
} from '../api/hooks.js';
import { ReviewItemCard } from '../components/ReviewItemCard.js';
import { RunProgress } from '../components/RunProgress.js';
import { WorkflowProgress } from '../components/WorkflowProgress.js';
import {
  Badge,
  Card,
  ErrorState,
  KeyValue,
  LoadingState,
  PageHeader,
  StatCard,
} from '../components/ui.js';
import {
  decisionSourceLabel,
  describeRunError,
  exportStatusLabel,
  exportStatusTone,
  reviewReasonLabel,
  runStatusDescription,
  runStatusLabel,
  statusTone,
  stepStatusLabel,
} from '../lib/status.js';
import type { PipelineStageKey } from '../lib/pipeline.js';
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
  const exportStatus = useRunExport(runId);
  const workflow = useWorkflow(run.data?.workflowSlug);

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

  const summary = exportStatus.data?.summary;
  const unresolved = summary?.unresolved ?? detail.openReviewItemCount;
  const primaryArtifact =
    exportStatus.data?.artifacts.find((artifact) => artifact.kind === 'output_xlsx') ??
    exportStatus.data?.artifacts[0];

  // Where the user is in the journey, derived from the run's real state rather than a stored flag.
  const stage: PipelineStageKey =
    detail.status === 'succeeded' ? (unresolved > 0 ? 'review' : 'export') : 'processing';

  return (
    <div className="page">
      <WorkflowProgress current={stage} />
      <PageHeader
        title="Run summary"
        description={`${detail.workflowName} · run ${detail.id.slice(0, 8)}`}
        actions={<Badge tone={statusTone(detail.status)}>{runStatusLabel(detail.status)}</Badge>}
      />

      <div className={`run-status run-status-${detail.status}`}>
        <p>{runStatusDescription(detail.status)}</p>
        {detail.status === 'succeeded' ? (
          <NextStep
            runId={detail.id}
            unresolved={unresolved}
            reportReady={Boolean(primaryArtifact)}
            reportUrl={primaryArtifact ? apiDownloadUrl(primaryArtifact.downloadUrl) : null}
            reportFormat={primaryArtifact?.format ?? null}
          />
        ) : null}
      </div>

      <RunProgress
        status={detail.status}
        startedAt={detail.startedAt}
        expectedSteps={workflow.data?.steps ?? []}
        recordedSteps={detail.steps}
      />

      {detail.error ? (
        <div className="error-state" role="alert">
          <strong>Processing stopped</strong>
          <p>{describeRunError(detail.error)}</p>
        </div>
      ) : null}

      <Card title="Overview" subtitle="What this run processed">
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

      <Card
        title="Reproducibility"
        subtitle="The exact setup and rules this run used, frozen when it was created"
      >
        {detail.snapshot ? (
          <>
            <KeyValue
              items={[
                {
                  label: 'Workflow version',
                  value: `v${detail.snapshot.workflowVersion}`,
                },
                {
                  label: 'Saved setup',
                  value: detail.snapshot.configurationName
                    ? `${detail.snapshot.configurationName} (v${detail.snapshot.configurationVersion})`
                    : 'Inline configuration (not saved)',
                },
                {
                  label: 'Rule set',
                  value: detail.snapshot.ruleSetName
                    ? `${detail.snapshot.ruleSetName} (v${detail.snapshot.ruleSetVersion}, ${detail.snapshot.ruleCount} rules)`
                    : 'Workflow default rules',
                },
                { label: 'Frozen at', value: formatDateTime(detail.snapshot.capturedAt) },
              ]}
            />
            <p className="muted small">
              Editing the setup or the rules later will not change this run — a new run picks up the
              new versions. This keeps every historical report auditable.
            </p>
          </>
        ) : (
          <p className="muted">This run predates run snapshots, so its inputs were not frozen.</p>
        )}
      </Card>

      <div className="stat-grid">
        <StatCard label="Records" value={detail.stats['accounts'] ?? '—'} />
        <StatCard label="Output rows" value={detail.stats['outputRows'] ?? '—'} />
        <StatCard label="Events" value={detail.stats['eventRows'] ?? '—'} />
        <StatCard label="Match rate" value={formatPercent(detail.stats['ruleMatchRate'])} />
        <StatCard label="Auto-resolved" value={detail.stats['autoApprovedAccounts'] ?? '—'} />
        <StatCard label="Needs review" value={detail.stats['reviewAccounts'] ?? '—'} />
        <StatCard label="Orphan events" value={detail.stats['orphanEventAccounts'] ?? '—'} />
      </div>

      <Card
        id="final-report"
        title="Final report"
        subtitle="Excel is the primary deliverable; the summary reflects automation and human decisions"
        actions={
          exportStatus.isSuccess ? (
            <Badge tone={exportStatusTone(exportStatus.data.status)}>
              {exportStatusLabel(exportStatus.data.status)}
            </Badge>
          ) : null
        }
      >
        {exportStatus.isLoading ? <LoadingState label="Loading report status…" /> : null}
        {exportStatus.isError ? (
          <ErrorState error={exportStatus.error} onRetry={() => void exportStatus.refetch()} />
        ) : null}
        {exportStatus.isSuccess ? (
          <>
            <p className="muted">{exportStatus.data.message}</p>
            <div className="stat-grid">
              <StatCard label="Total records" value={exportStatus.data.summary.totalRecords} />
              <StatCard label="Auto-resolved" value={exportStatus.data.summary.autoResolved} />
              <StatCard label="Reviewed" value={exportStatus.data.summary.reviewed} />
              <StatCard label="Unresolved" value={exportStatus.data.summary.unresolved} />
              <StatCard label="Errors" value={exportStatus.data.summary.errors} />
              <StatCard label="Unmatched" value={exportStatus.data.summary.unmatched} />
            </div>
            {exportStatus.data.summary.unresolved > 0 ? (
              <p className="muted small">
                {exportStatus.data.summary.unresolved}{' '}
                {exportStatus.data.summary.unresolved === 1
                  ? 'case still needs'
                  : 'cases still need'}{' '}
                a human decision.{' '}
                <Link className="link" to={`/review?runId=${detail.id}`}>
                  Review now
                </Link>
              </p>
            ) : null}
            {exportStatus.data.validation ? (
              <p className="muted small">
                Checked on export: {exportStatus.data.validation.rowCount} rows ×{' '}
                {exportStatus.data.validation.columnCount} columns.
              </p>
            ) : null}
            {exportStatus.data.artifacts.length > 0 ? (
              <div className="export-actions">
                {exportStatus.data.artifacts.map((artifact) => (
                  <a
                    key={artifact.id}
                    className="button"
                    href={apiDownloadUrl(artifact.downloadUrl)}
                    download
                  >
                    Download {artifact.format.toUpperCase()}
                    <span className="muted small"> ({formatBytes(artifact.sizeBytes)})</span>
                  </a>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </Card>

      <Card
        title="Review queue"
        subtitle="Only the unusual records require a human decision"
        actions={
          <Link className="button" to={`/review?runId=${detail.id}`}>
            Open review queue
          </Link>
        }
      >
        {reviewItems.isLoading ? <LoadingState label="Loading review items…" /> : null}
        {reviewItems.isError ? (
          <ErrorState error={reviewItems.error} onRetry={() => void reviewItems.refetch()} />
        ) : null}
        {reviewItems.isSuccess && reviewItems.data.items.length === 0 ? (
          <p className="muted">
            Nothing to review — every record was classified automatically with high confidence.
          </p>
        ) : null}
        <div className="review-list">
          {reviewItems.data?.items.map((item) => (
            <ReviewItemCard key={item.id} item={item} />
          ))}
        </div>
      </Card>

      {detail.steps.length > 0 ? (
        <Card title="Processing steps" subtitle="The pipeline stages that ran, with their metrics">
          <ol className="step-list">
            {detail.steps.map((step) => (
              <li key={step.id}>
                <div className="step-header">
                  <span className="step-name">{step.name}</span>
                  <Badge tone={statusTone(step.status)}>{stepStatusLabel(step.status)}</Badge>
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
      ) : null}

      <Card title="Generated files" subtitle="Every file produced by this run">
        {artifacts.isLoading ? <LoadingState label="Loading files…" /> : null}
        {artifacts.isError ? (
          <ErrorState error={artifacts.error} onRetry={() => void artifacts.refetch()} />
        ) : null}
        {artifacts.isSuccess && artifacts.data.items.length === 0 ? (
          <p className="muted">No files were produced.</p>
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
        title="Decision log"
        subtitle="Every record keeps the rule, confidence and evidence behind its output"
      >
        {decisions.isLoading ? <LoadingState label="Loading decisions…" /> : null}
        {decisions.isError ? (
          <ErrorState error={decisions.error} onRetry={() => void decisions.refetch()} />
        ) : null}
        {decisions.isSuccess ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Rule</th>
                  <th>Source</th>
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
                    <td className="small">{decisionSourceLabel(decision.decisionSource)}</td>
                    <td>{Math.round(decision.confidence * 100)}%</td>
                    <td className="small">
                      {decision.reviewReasons.length > 0
                        ? decision.reviewReasons.map(reviewReasonLabel).join(', ')
                        : '—'}
                    </td>
                    <td>{formatCellValue(decision.outputValues['RootCause'])}</td>
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

function NextStep({
  runId,
  unresolved,
  reportReady,
  reportUrl,
  reportFormat,
}: {
  runId: string;
  unresolved: number;
  reportReady: boolean;
  reportUrl: string | null;
  reportFormat: string | null;
}) {
  if (unresolved > 0) {
    return (
      <div className="next-step">
        <strong>
          {unresolved} {unresolved === 1 ? 'record needs' : 'records need'} your decision
        </strong>
        <p className="muted small">
          The report is generated but marked “waiting for review” until a person resolves these
          cases.
        </p>
        <Link className="button button-primary" to={`/review?runId=${runId}`}>
          Review {unresolved} {unresolved === 1 ? 'exception' : 'exceptions'}
        </Link>
      </div>
    );
  }

  return (
    <div className="next-step">
      <strong>Everything is resolved — your report is ready</strong>
      <p className="muted small">
        Download the finished file below, or from the Final report card.
      </p>
      {reportReady && reportUrl ? (
        <a className="button button-primary" href={reportUrl} download>
          Download {(reportFormat ?? 'xlsx').toUpperCase()} report
        </a>
      ) : null}
    </div>
  );
}
