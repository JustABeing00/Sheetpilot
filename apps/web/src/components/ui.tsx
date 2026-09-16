import type { ReactNode } from 'react';
import { ApiError } from '../api/client.js';
import type { BadgeTone } from '../lib/status.js';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  id,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={className ? `card ${className}` : 'card'}>
      {title || actions ? (
        <div className="card-header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-state">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError
      ? `${error.message} (${error.code})`
      : error instanceof Error
        ? error.message
        : 'Something went wrong while loading data.';

  return (
    <div className="error-state" role="alert">
      <strong>Request failed</strong>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function KeyValue({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="key-value">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A short, non-blocking message. `tone` drives the colour; `role` picks the right ARIA semantics
 * (errors are assertive, everything else is polite).
 */
export function Alert({
  tone = 'info',
  title,
  children,
  actions,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="alert-text">
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
      {actions ? <div className="alert-actions">{actions}</div> : null}
    </div>
  );
}

/** A slim progress bar. Omit `value` for an indeterminate "working" state. */
export function ProgressBar({
  value,
  label,
  indeterminate = false,
}: {
  value?: number;
  label?: string;
  indeterminate?: boolean;
}) {
  const clamped = value === undefined ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="progress">
      <div
        className={indeterminate ? 'progress-track progress-indeterminate' : 'progress-track'}
        role="progressbar"
        aria-label={label}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={indeterminate ? undefined : clamped}
      >
        {indeterminate ? null : <div className="progress-fill" style={{ width: `${clamped}%` }} />}
      </div>
      {label ? <span className="progress-label">{label}</span> : null}
    </div>
  );
}
