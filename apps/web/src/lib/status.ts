export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'succeeded':
    case 'resolved_accepted':
      return 'success';
    case 'failed':
      return 'danger';
    case 'running':
      return 'info';
    case 'queued':
    case 'pending':
    case 'skipped':
      return 'neutral';
    case 'resolved_overridden':
      return 'info';
    case 'dismissed':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function reviewStateTone(state: string): BadgeTone {
  switch (state) {
    case 'APPROVED':
    case 'AUTO_RESOLVED':
      return 'success';
    case 'OVERRIDDEN':
      return 'info';
    case 'ERROR':
      return 'danger';
    case 'DISMISSED':
      return 'neutral';
    case 'NEEDS_REVIEW':
    default:
      return 'warning';
  }
}

export function exportStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'ready':
      return 'success';
    case 'pending_review':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'processing':
      return 'info';
    default:
      return 'neutral';
  }
}

export function severityTone(severity: string): BadgeTone {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

/** Plain-language run status, so the UI never shows a bare internal token. */
export function runStatusLabel(status: string): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Processing';
    case 'succeeded':
      return 'Finished';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    default:
      return status;
  }
}

/** One sentence telling the user what the status means and what happens next. */
export function runStatusDescription(status: string): string {
  switch (status) {
    case 'queued':
      return 'The run is waiting to start. This page updates automatically.';
    case 'running':
      return 'Processing the files now. Results appear here when it finishes.';
    case 'succeeded':
      return 'Processing is complete. Check the review queue for unusual cases, then download the report.';
    case 'failed':
      return 'Processing stopped before it could finish. See the details below and try again.';
    case 'canceled':
      return 'The run was canceled before it finished.';
    default:
      return '';
  }
}

export function exportStatusLabel(status: string): string {
  switch (status) {
    case 'ready':
      return 'Report ready';
    case 'pending_review':
      return 'Waiting for review';
    case 'processing':
      return 'Preparing report';
    case 'failed':
      return 'Report unavailable';
    default:
      return 'No report yet';
  }
}

/**
 * Turns a technical error message into a short, actionable explanation. Falls back to the original
 * message so a genuinely unexpected error is never hidden from the operator.
 */
export function describeRunError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('column') && (lower.includes('missing') || lower.includes('not found'))) {
    return 'A mapped column could not be found in the uploaded file. Re-check the setup, then run again.';
  }
  if (lower.includes('no column mapped') || lower.includes('no dataset assigned')) {
    return 'The setup is incomplete. Assign the files and map the columns, then run again.';
  }
  if (lower.includes('not registered')) {
    return 'This workflow is not available in the running application.';
  }
  if (lower.includes('file') && (lower.includes('not found') || lower.includes('could not be found'))) {
    return 'One of the input files is no longer available. Upload it again and start a new run.';
  }
  if (lower.includes('export') && lower.includes('validat')) {
    return 'The generated report failed a safety check and was not published. This is a bug — please report it.';
  }
  return message;
}

