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

/** Plain-language label for a resolved/derived review state, so no internal token reaches the user. */
export function reviewStateLabel(state: string): string {
  switch (state) {
    case 'AUTO_RESOLVED':
      return 'Automated';
    case 'NEEDS_REVIEW':
      return 'Needs review';
    case 'APPROVED':
      return 'Approved';
    case 'OVERRIDDEN':
      return 'Overridden';
    case 'DISMISSED':
      return 'Dismissed';
    case 'ERROR':
      return 'Error';
    default:
      return state;
  }
}

/** Plain-language label for the reason a record was routed to a human. */
export function reviewReasonLabel(reason: string): string {
  switch (reason) {
    case 'no_events':
      return 'No matching records';
    case 'no_rule_match':
      return 'No rule matched';
    case 'rule_conflict':
      return 'Conflicting rules';
    case 'low_confidence':
      return 'Low confidence';
    case 'ambiguous_latest_timestamp':
      return 'Tied dates';
    case 'conflicting_fault_history':
      return 'Conflicting history';
    case 'unparsed_timestamp':
      return 'Unreadable date';
    case 'duplicate_primary_key':
      return 'Duplicate record';
    case 'ai_low_confidence':
      return 'AI unsure';
    case 'ai_ambiguous':
      return 'AI ambiguous';
    case 'ai_proposed_alternative':
      return 'AI suggests another result';
    case 'ai_failed':
      return 'AI unavailable';
    default:
      return reason.replace(/[_-]+/g, ' ');
  }
}

/** One sentence explaining what a reviewer should do about a specific reason. */
export function reviewReasonHelp(reason: string): string {
  switch (reason) {
    case 'no_events':
      return 'No supporting records were found for this row. Confirm the result or fill it in yourself.';
    case 'no_rule_match':
      return 'No business rule matched. Choose the correct outcome, or add a rule so next time is automatic.';
    case 'rule_conflict':
      return 'Two rules of equal priority disagreed. Pick the one that is right.';
    case 'low_confidence':
      return 'The matched rule is below the confidence threshold. Verify the result.';
    case 'ambiguous_latest_timestamp':
      return 'Two records share the latest date. Check which one is really the most recent.';
    case 'conflicting_fault_history':
      return 'The history is inconsistent. Choose the correct outcome for the latest record.';
    case 'unparsed_timestamp':
      return 'A date could not be read. Check the source file and correct the result.';
    case 'duplicate_primary_key':
      return 'The same key appears more than once. Both rows are kept — confirm they should share this result.';
    case 'ai_low_confidence':
      return 'The AI suggestion was not confident enough to use. Decide from the evidence above.';
    case 'ai_ambiguous':
      return 'The AI found the record ambiguous. Decide from the evidence above.';
    case 'ai_proposed_alternative':
      return 'The AI proposed a different result than the rule. The rule was kept — confirm or override.';
    case 'ai_failed':
      return 'The AI step failed, so only the deterministic result is available.';
    default:
      return 'Confirm the result or override it with the correct values.';
  }
}

/** Plain-language label for how the automated result was produced. */
export function decisionSourceLabel(source: string): string {
  switch (source) {
    case 'deterministic':
      return 'Rule-based';
    case 'ai_suggested':
      return 'AI-assisted';
    case 'none':
      return 'No automated result';
    default:
      return source;
  }
}

/** Plain-language severity used by the review queue. */
export function severityLabel(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'Urgent';
    case 'warning':
      return 'Check';
    default:
      return 'Info';
  }
}

/** Plain-language pipeline step status. */
export function stepStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Waiting';
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    default:
      return status;
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
  if (
    lower.includes('file') &&
    (lower.includes('not found') || lower.includes('could not be found'))
  ) {
    return 'One of the input files is no longer available. Upload it again and start a new run.';
  }
  if (lower.includes('export') && lower.includes('validat')) {
    return 'The generated report failed a safety check and was not published. This is a bug — please report it.';
  }
  return message;
}
