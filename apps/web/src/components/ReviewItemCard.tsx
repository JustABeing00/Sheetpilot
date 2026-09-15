import { useMemo, useState } from 'react';
import type { ReviewItemDto } from '@sheetpilot/core';
import { useResolveReviewItem } from '../api/hooks.js';
import { formatCellValue, formatDateTime, humanizeToken } from '../lib/format.js';
import { Badge } from './ui.js';
import { severityTone } from '../lib/status.js';

interface EvidenceView {
  faultCount?: number;
  latestFault?: { occurredAt?: string | null; description?: string | null } | null;
  explanation?: string;
  matchedRuleIds?: string[];
  reasons?: string[];
  ai?: { consulted?: boolean; suggestions?: Array<{ label?: string; confidence?: number }> };
}

export function ReviewItemCard({
  item,
  showRunLink = false,
}: {
  item: ReviewItemDto;
  showRunLink?: boolean;
}) {
  const resolve = useResolveReviewItem();
  const [mode, setMode] = useState<'idle' | 'overriding'>('idle');
  const [note, setNote] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const evidence = item.evidence as EvidenceView;
  const suggestionKeys = useMemo(() => Object.keys(item.suggestedValues), [item.suggestedValues]);
  const isOpen = item.status === 'open';

  const submit = (
    action: 'accepted' | 'overridden' | 'dismissed',
    values?: Record<string, string>,
  ) => {
    resolve.mutate({
      id: item.id,
      body: { action, values: values ?? {}, note },
    });
  };

  return (
    <article className={isOpen ? 'review-card' : 'review-card review-card-resolved'}>
      <header className="review-card-header">
        <div>
          <span className="entity-key">{item.entityKey}</span>
          <div className="review-card-badges">
            <Badge tone={severityTone(item.severity)}>{humanizeToken(item.reason)}</Badge>
            <Badge tone={isOpen ? 'warning' : 'success'}>{humanizeToken(item.status)}</Badge>
            {item.workflowSlug ? <span className="muted">{item.workflowSlug}</span> : null}
          </div>
        </div>
        <div className="review-card-meta">
          <span>{formatDateTime(item.createdAt)}</span>
          {showRunLink ? (
            <a className="link" href={`/runs/${item.runId}`}>
              Open run
            </a>
          ) : null}
        </div>
      </header>

      <p className="review-card-title">{item.title}</p>
      <p className="review-card-detail">{item.detail}</p>

      <div className="review-evidence">
        {evidence.faultCount !== undefined ? (
          <div>
            <span className="evidence-label">Faults</span>
            <span>{evidence.faultCount}</span>
          </div>
        ) : null}
        {evidence.latestFault?.occurredAt || evidence.latestFault?.description ? (
          <div>
            <span className="evidence-label">Latest fault</span>
            <span>
              {formatDateTime(evidence.latestFault?.occurredAt)}
              {evidence.latestFault?.description ? ` — ${evidence.latestFault.description}` : ''}
            </span>
          </div>
        ) : null}
        {evidence.matchedRuleIds && evidence.matchedRuleIds.length > 0 ? (
          <div>
            <span className="evidence-label">Matched rules</span>
            <span>{evidence.matchedRuleIds.join(', ')}</span>
          </div>
        ) : null}
        {evidence.explanation ? (
          <div>
            <span className="evidence-label">Why</span>
            <span>{evidence.explanation}</span>
          </div>
        ) : null}
        {evidence.ai?.consulted ? (
          <div>
            <span className="evidence-label">AI consulted</span>
            <span>
              {evidence.ai.suggestions && evidence.ai.suggestions.length > 0
                ? evidence.ai.suggestions
                    .map(
                      (suggestion) =>
                        `${suggestion.label ?? 'suggestion'} (${Math.round((suggestion.confidence ?? 0) * 100)}%)`,
                    )
                    .join(', ')
                : 'no suggestion returned'}
            </span>
          </div>
        ) : null}
      </div>

      {suggestionKeys.length > 0 ? (
        <div className="suggested-values">
          <span className="evidence-label">Suggested values</span>
          <ul>
            {suggestionKeys.map((key) => (
              <li key={key}>
                <span>{key}</span>
                <strong>{formatCellValue(item.suggestedValues[key])}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isOpen ? (
        <div className="review-actions">
          {mode === 'overriding' ? (
            <div className="override-form">
              {suggestionKeys.length === 0 ? (
                <p className="muted">
                  No suggested values — add the values this account should have.
                </p>
              ) : null}
              <div className="override-grid">
                {suggestionKeys.map((key) => (
                  <label key={key} className="field">
                    <span className="field-label">{key}</span>
                    <input
                      className="input"
                      value={overrides[key] ?? String(item.suggestedValues[key] ?? '')}
                      onChange={(event) =>
                        setOverrides((current) => ({ ...current, [key]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="review-action-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={resolve.isPending}
                  onClick={() => {
                    const values = Object.fromEntries(
                      suggestionKeys.map((key) => [
                        key,
                        overrides[key] ?? String(item.suggestedValues[key] ?? ''),
                      ]),
                    );
                    submit('overridden', values);
                    setMode('idle');
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
            <div className="review-action-row">
              <button
                type="button"
                className="button button-primary"
                disabled={resolve.isPending}
                onClick={() => submit('accepted')}
              >
                Accept suggestion
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
                onClick={() => submit('dismissed')}
              >
                Dismiss
              </button>
            </div>
          )}

          <label className="field">
            <span className="field-label">Reviewer note</span>
            <input
              className="input"
              placeholder="Optional context for this decision"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="resolution">
          <Badge tone="success">{humanizeToken(item.status)}</Badge>
          {item.resolution?.note ? <span className="muted">{item.resolution.note}</span> : null}
          <span className="muted">{formatDateTime(item.resolvedAt)}</span>
        </div>
      )}
    </article>
  );
}
