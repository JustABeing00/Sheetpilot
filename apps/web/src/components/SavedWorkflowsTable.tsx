import { Link } from 'react-router-dom';
import type { SavedWorkflowSummaryDto } from '@sheetpilot/core';
import { Badge } from './ui.js';
import { formatDateTime } from '../lib/format.js';
import { exportStatusLabel, exportStatusTone, runStatusLabel, statusTone } from '../lib/status.js';

/**
 * The returning-user dashboard table: one row per saved workflow with its latest-run status, records
 * processed, review count, report availability and a direct "Run again" action.
 */
export function SavedWorkflowsTable({ items }: { items: SavedWorkflowSummaryDto[] }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Workflow</th>
            <th>Last run</th>
            <th>Status</th>
            <th>Records</th>
            <th>Review</th>
            <th>Report</th>
            <th className="table-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link className="link" to={`/saved-workflows/${item.id}`}>
                  <strong>{item.name}</strong>
                </Link>
                <div className="muted small">
                  {item.workflowName} · v{item.configurationVersion} ·{' '}
                  {item.ruleSet ? `${item.ruleSet.ruleCount} rules` : 'no rules'}
                </div>
              </td>
              <td>
                {item.lastRun ? (
                  <span title={item.lastRun.id}>{formatDateTime(item.lastRun.createdAt)}</span>
                ) : (
                  <span className="muted">Never run</span>
                )}
              </td>
              <td>
                {item.lastRun ? (
                  <Badge tone={statusTone(item.lastRun.status)}>
                    {runStatusLabel(item.lastRun.status)}
                  </Badge>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>{item.lastRun ? item.lastRun.recordsProcessed : '—'}</td>
              <td>
                {item.lastRun ? (
                  item.lastRun.reviewItemCount === 0 ? (
                    <span className="muted">none</span>
                  ) : (
                    <Link className="link" to={`/review?runId=${item.lastRun.id}`}>
                      {item.lastRun.openReviewItemCount} open / {item.lastRun.reviewItemCount}
                    </Link>
                  )
                ) : (
                  '—'
                )}
              </td>
              <td>
                {item.lastRun ? (
                  item.lastRun.exportReady ? (
                    <Link className="link" to={`/runs/${item.lastRun.id}`}>
                      <Badge tone="success">Ready</Badge>
                    </Link>
                  ) : (
                    <Badge tone={exportStatusTone(item.lastRun.exportStatus)}>
                      {exportStatusLabel(item.lastRun.exportStatus)}
                    </Badge>
                  )
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="table-actions">
                <Link
                  className="button small button-primary"
                  to={`/saved-workflows/${item.id}/run`}
                >
                  Run again
                </Link>
                <Link className="button small" to={`/saved-workflows/${item.id}`}>
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
