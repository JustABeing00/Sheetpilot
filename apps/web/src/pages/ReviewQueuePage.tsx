import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ReviewFilter, ReviewItemDto } from '@sheetpilot/core';
import {
  AI_AMBIGUITY_LABELS,
  AI_FAILURE_LABELS,
  REVIEW_FILTER_DEFINITIONS,
} from '@sheetpilot/core';
import { useResolveReviewItem, useReviewHistory, useReviewQueue } from '../api/hooks.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui.js';
import { WorkflowProgress } from '../components/WorkflowProgress.js';
import { useToast } from '../components/toast-context.js';
import { formatCellValue, formatDateTime } from '../lib/format.js';
import {
  decisionSourceLabel,
  reviewReasonHelp,
  reviewReasonLabel,
  reviewStateLabel,
  reviewStateTone,
  severityLabel,
  severityTone,
} from '../lib/status.js';

function outputFieldsFor(item: ReviewItemDto): string[] {
  const fields = new Set<string>([
    ...Object.keys(item.automation.values),
    ...Object.keys(item.suggestedValues),
  ]);
  return [...fields];
}

export function ReviewQueuePage() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId') ?? undefined;
  const [filter, setFilter] = useState<ReviewFilter>('needs_review');
  const queue = useReviewQueue(filter, runId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  useEffect(() => {
    if (!selected && items.length > 0 && items[0]) {
      setSelectedId(items[0].id);
    }
  }, [selected, items]);

  const counts = queue.data?.counts;

  const badgeFor = (key: ReviewFilter): number | null => {
    if (!counts) {
      return null;
    }
    switch (key) {
      case 'needs_review':
        return counts.needsReview;
      case 'unresolved':
        return counts.open;
      case 'conflicts':
        return counts.conflicts;
      case 'low_confidence':
        return counts.lowConfidence;
      case 'processing_errors':
        return counts.processingErrors;
      case 'overridden':
        return counts.overridden;
      default:
        return null;
    }
  };

  return (
    <div className="page">
      <WorkflowProgress current="review" />
      <PageHeader
        title={runId ? 'Review exceptions' : 'Review queue'}
        description="Only the unusual cases need a human. Accept, override or dismiss with a full audit trail."
        actions={
          <span className="muted small">
            {counts ? `${counts.open} open · ${counts.total} total` : ''}
          </span>
        }
      />

      {runId ? (
        <div className="context-banner">
          <span>
            Showing review items for <span className="mono">{runId.slice(0, 8)}</span> only.
          </span>
          <span className="context-banner-actions">
            <Link className="link" to={`/runs/${runId}`}>
              Back to run summary
            </Link>
            <Link className="link" to={`/runs/${runId}#final-report`}>
              Go to report
            </Link>
          </span>
        </div>
      ) : null}

      <div className="review-filters" role="tablist" aria-label="Review filters">
        {REVIEW_FILTER_DEFINITIONS.map((definition) => {
          const badge = badgeFor(definition.key);
          return (
            <button
              key={definition.key}
              type="button"
              role="tab"
              aria-selected={filter === definition.key}
              title={definition.description}
              className={filter === definition.key ? 'filter-chip active' : 'filter-chip'}
              onClick={() => {
                setFilter(definition.key);
                setSelectedId(null);
              }}
            >
              {definition.label}
              {badge !== null && badge > 0 ? <span className="filter-count">{badge}</span> : null}
            </button>
          );
        })}
      </div>

      {queue.isLoading ? <LoadingState label="Loading review queue…" /> : null}
      {queue.isError ? (
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
      ) : null}

      {queue.isSuccess && items.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          description="No cases match this filter. Every remaining account was classified with high confidence."
        />
      ) : null}

      {items.length > 0 && selected ? (
        <div className="review-workspace">
          <ul className="review-inbox" aria-label="Review items">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selected.id ? 'inbox-row active' : 'inbox-row'}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="inbox-row-top">
                    <span className="mono inbox-entity">{item.entityKey}</span>
                    <Badge tone={severityTone(item.severity)}>
                      {reviewReasonLabel(item.reason)}
                    </Badge>
                  </span>
                  <span className="inbox-row-sub">
                    {item.automation.confidence === null
                      ? 'No automated confidence'
                      : `${Math.round(item.automation.confidence * 100)}% · ${decisionSourceLabel(
                          item.automation.decisionSource,
                        )}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <ReviewDetail key={selected.id} item={selected} items={items} onSelect={setSelectedId} />
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {selected
          ? `Showing ${selected.entityKey}: ${reviewReasonLabel(selected.reason)}.`
          : 'No cases match this filter.'}
      </p>
    </div>
  );
}

function ReviewDetail({
  item,
  items,
  onSelect,
}: {
  item: ReviewItemDto;
  items: ReviewItemDto[];
  onSelect: (id: string) => void;
}) {
  const resolve = useResolveReviewItem();
  const history = useReviewHistory(item.id);
  const toast = useToast();
  const [mode, setMode] = useState<'idle' | 'overriding'>('idle');
  const [note, setNote] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [newField, setNewField] = useState('');
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const fields = useMemo(() => outputFieldsFor(item), [item]);
  const isOpen = item.status === 'open';
  const ai = item.ai;

  const currentIndex = items.findIndex((entry) => entry.id === item.id);
  const nextId =
    items[currentIndex + 1]?.id ?? items.find((entry) => entry.id !== item.id)?.id ?? null;
  const prevId =
    currentIndex > 0 ? (items[currentIndex - 1]?.id ?? null) : (items.at(-1)?.id ?? null);

  const submit = (
    action: 'accepted' | 'overridden' | 'dismissed',
    values?: Record<string, string>,
  ) => {
    resolve.mutate(
      { id: item.id, body: { action, values: values ?? {}, note } },
      {
        onSuccess: () => {
          const verb =
            action === 'accepted' ? 'Approved' : action === 'overridden' ? 'Overrode' : 'Dismissed';
          toast.show(`${verb} ${item.entityKey}.`, action === 'dismissed' ? 'info' : 'success');
          setNote('');
          setOverrides({});
          setMode('idle');
          onSelect(nextId ?? item.id);
        },
        onError: (error) => {
          toast.show(
            error instanceof Error ? error.message : 'The decision could not be saved.',
            'danger',
          );
        },
      },
    );
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (confirmingDismiss || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === 'Escape') {
        if (mode === 'overriding') {
          setMode('idle');
        } else if (showHelp) {
          setShowHelp(false);
        }
        return;
      }
      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        event.preventDefault();
        setShowHelp((current) => !current);
        return;
      }
      if (typing) {
        return;
      }
      if (event.key === 'a') {
        submit('accepted');
      } else if (event.key === 'o') {
        setMode('overriding');
      } else if (event.key === 'd') {
        setConfirmingDismiss(true);
      } else if ((event.key === 'j' || event.key === 'ArrowDown') && nextId) {
        onSelect(nextId);
      } else if ((event.key === 'k' || event.key === 'ArrowUp') && prevId) {
        onSelect(prevId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // submit is stable enough for this scope; the handlers are re-bound on the values they read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, nextId, prevId, note, mode, confirmingDismiss, showHelp]);

  const valueFor = (field: string): string =>
    overrides[field] ?? String(item.suggestedValues[field] ?? item.automation.values[field] ?? '');

  const addField = () => {
    const field = newField.trim();
    if (field.length === 0 || fields.includes(field)) {
      return;
    }
    setOverrides((current) => ({ ...current, [field]: '' }));
    setNewField('');
  };

  const overrideFields = [...new Set([...fields, ...Object.keys(overrides)])];

  return (
    <section className="review-detail">
      <header className="review-detail-header">
        <div>
          <span className="entity-key">{item.entityKey}</span>
          <div className="review-card-badges">
            <Badge tone={reviewStateTone(item.state)}>{reviewStateLabel(item.state)}</Badge>
            <Badge tone={severityTone(item.severity)}>{severityLabel(item.severity)}</Badge>
            <Badge tone={severityTone(item.severity)}>{reviewReasonLabel(item.reason)}</Badge>
            {item.workflowSlug ? <span className="muted">{item.workflowSlug}</span> : null}
          </div>
        </div>
        <div className="review-card-meta">
          <span className="review-position">
            {currentIndex >= 0 ? `${currentIndex + 1} of ${items.length}` : null}
          </span>
          <span>{formatDateTime(item.createdAt)}</span>
          <Link className="link" to={`/runs/${item.runId}`}>
            Open run
          </Link>
          <button
            type="button"
            className="button button-ghost small"
            aria-expanded={showHelp}
            onClick={() => setShowHelp((current) => !current)}
          >
            Shortcuts
          </button>
        </div>
      </header>

      {showHelp ? (
        <div className="shortcut-help" role="note">
          <kbd>a</kbd> accept · <kbd>o</kbd> override · <kbd>d</kbd> dismiss · <kbd>j</kbd>/
          <kbd>↓</kbd> next · <kbd>k</kbd>/<kbd>↑</kbd> previous · <kbd>Esc</kbd> cancel ·{' '}
          <kbd>?</kbd> toggle this help
        </div>
      ) : null}

      <p className="review-card-title">{item.title}</p>
      <p className="review-card-detail">{item.detail}</p>
      <p className="review-advice">
        <strong>Why you are seeing this:</strong> {reviewReasonHelp(item.reason)}
      </p>

      <div className="review-detail-grid">
        <div className="review-panel">
          <h3>Automation result</h3>
          <KeyValueList
            items={[
              ['Source', decisionSourceLabel(item.automation.decisionSource)],
              [
                'Confidence',
                item.automation.confidence === null
                  ? '—'
                  : `${Math.round(item.automation.confidence * 100)}%`,
              ],
              ['Rule', item.automation.matchedRuleIds.join(', ') || 'No rule matched'],
              ['Status', item.automation.ruleStatus ?? '—'],
            ]}
          />
          {Object.keys(item.automation.values).length > 0 ? (
            <div className="suggested-values">
              <span className="evidence-label">Proposed values</span>
              <ul>
                {Object.entries(item.automation.values).map(([key, value]) => (
                  <li key={key}>
                    <span>{key}</span>
                    <strong>{formatCellValue(value)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted small">No deterministic values were produced.</p>
          )}
          {item.automation.explanation ? (
            <div className="review-why">
              <span className="evidence-label">Why</span>
              <span>{item.automation.explanation}</span>
            </div>
          ) : null}
          {item.automation.applicableRules.length > 0 ? (
            <div className="review-rules">
              <span className="evidence-label">Applicable rules</span>
              <ul>
                {item.automation.applicableRules.map((rule) => (
                  <li key={rule.ruleId}>
                    <span>{rule.ruleName}</span>
                    <span className="muted small">
                      priority {rule.priority} · {Math.round(rule.confidence * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="review-panel">
          <h3>Event history</h3>
          {item.latestEvent ? (
            <div className="latest-event">
              <span className="evidence-label">Latest fault</span>
              <strong>{formatDateTime(item.latestEvent.occurredAt)}</strong>
              <p>{item.latestEvent.description || 'No description'}</p>
            </div>
          ) : (
            <p className="muted small">No fault records were found for this account.</p>
          )}
          {item.eventHistory.length > 0 ? (
            <ul className="event-history">
              {item.eventHistory.map((event) => (
                <li key={`${event.rowIndex}-${event.occurredAt}`}>
                  <span className="muted small">{formatDateTime(event.occurredAt)}</span>
                  <span>{event.description || 'No description'}</span>
                  {event.rootCause ? <Badge tone="info">{event.rootCause}</Badge> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {ai && ai.status === 'suggested' ? (
            <div className="ai-suggestion">
              <span className="evidence-label">AI suggestion</span>
              <strong>
                {ai.result.proposedLabel || ai.result.proposedCode} (
                {Math.round(ai.result.confidence * 100)}%)
              </strong>
              {ai.result.reasoning ? <p>{ai.result.reasoning}</p> : null}
              {ai.result.ambiguity.length > 0 ? (
                <p className="muted small">
                  Ambiguity:{' '}
                  {ai.result.ambiguity.map((flag) => AI_AMBIGUITY_LABELS[flag]).join(', ')}
                </p>
              ) : null}
              {ai.result.missingInformation.length > 0 ? (
                <p className="muted small">Missing: {ai.result.missingInformation.join('; ')}</p>
              ) : null}
            </div>
          ) : null}
          {ai && ai.status === 'failed' ? (
            <p className="muted small">
              AI: {AI_FAILURE_LABELS[ai.failure]} — decide from the deterministic evidence above.
            </p>
          ) : null}
        </div>
      </div>

      {isOpen ? (
        <div className="review-actions">
          {mode === 'overriding' ? (
            <div className="override-form">
              <div className="override-grid">
                {overrideFields.map((field) => (
                  <label key={field} className="field">
                    <span className="field-label">{field}</span>
                    <input
                      className="input"
                      value={valueFor(field)}
                      onChange={(event) =>
                        setOverrides((current) => ({ ...current, [field]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="inline-add">
                <input
                  className="input"
                  placeholder="Add field (e.g. RootCause)"
                  value={newField}
                  onChange={(event) => setNewField(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addField();
                    }
                  }}
                />
                <button type="button" className="button" onClick={addField}>
                  Add field
                </button>
              </div>
              <label className="field">
                <span className="field-label">Reviewer note</span>
                <input
                  className="input"
                  placeholder="Optional context for this decision"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <div className="review-action-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={resolve.isPending}
                  onClick={() => {
                    const values = Object.fromEntries(
                      overrideFields.map((field) => [field, valueFor(field)]),
                    );
                    submit('overridden', values);
                  }}
                >
                  Save override
                </button>
                <button type="button" className="button" onClick={() => setMode('idle')}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <label className="field">
                <span className="field-label">Reviewer note</span>
                <input
                  className="input"
                  placeholder="Optional context for this decision"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <div className="review-action-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={resolve.isPending}
                  onClick={() => submit('accepted')}
                >
                  Accept result
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={resolve.isPending}
                  onClick={() => setMode('overriding')}
                >
                  Override
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={resolve.isPending}
                  onClick={() => setConfirmingDismiss(true)}
                >
                  Dismiss
                </button>
                {nextId ? (
                  <button type="button" className="button" onClick={() => onSelect(nextId)}>
                    Next without saving
                  </button>
                ) : null}
              </div>
              <p className="muted small">
                Accepting or overriding updates the report and cannot be undone. Dismiss leaves the
                automated result in place.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="resolution">
          <Badge tone={reviewStateTone(item.state)}>{reviewStateLabel(item.state)}</Badge>
          {item.resolution?.note ? <span className="muted">{item.resolution.note}</span> : null}
          <span className="muted">{formatDateTime(item.resolvedAt)}</span>
        </div>
      )}

      <div className="audit-trail">
        <h3>Audit trail</h3>
        {history.isLoading ? <span className="muted small">Loading history…</span> : null}
        {history.isSuccess && history.data.items.length === 0 ? (
          <p className="muted small">
            No human decision yet —{' '}
            {decisionSourceLabel(item.automation.decisionSource).toLowerCase()} decided this case
            automatically.
          </p>
        ) : null}
        {history.data?.items.map((entry) => (
          <div key={entry.id} className="audit-entry">
            <div>
              <Badge tone={reviewStateTone(entry.resultingState)}>
                {reviewStateLabel(entry.resultingState)}
              </Badge>
              <span className="muted small">{formatDateTime(entry.createdAt)}</span>
            </div>
            <p className="small">
              Automation proposed{' '}
              {Object.keys(entry.automation.values).length === 0
                ? 'no values'
                : Object.entries(entry.automation.values)
                    .map(([key, value]) => `${key}=${formatCellValue(value)}`)
                    .join(', ')}
            </p>
            {entry.changedFields.length > 0 ? (
              <p className="small">
                Human changed <strong>{entry.changedFields.join(', ')}</strong> to{' '}
                {entry.changedFields
                  .map((field) => `${field}=${formatCellValue(entry.appliedValues[field])}`)
                  .join(', ')}
              </p>
            ) : (
              <p className="small muted">Human kept the automated values.</p>
            )}
            {entry.note ? <p className="small muted">“{entry.note}”</p> : null}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmingDismiss}
        title={`Dismiss ${item.entityKey}?`}
        description="The automated result stays in the report, but this case will no longer ask for a human decision. Dismissing cannot be undone from the app."
        confirmLabel="Dismiss case"
        busy={resolve.isPending}
        onCancel={() => setConfirmingDismiss(false)}
        onConfirm={() => {
          setConfirmingDismiss(false);
          submit('dismissed');
        }}
      />
    </section>
  );
}

function KeyValueList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="mini-kv">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
