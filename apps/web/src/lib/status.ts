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
