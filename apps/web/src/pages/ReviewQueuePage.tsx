import { useState } from 'react';
import { useReviewQueue } from '../api/hooks.js';
import { ReviewItemCard } from '../components/ReviewItemCard.js';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui.js';

export function ReviewQueuePage() {
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const queue = useReviewQueue(status);

  return (
    <div className="page">
      <PageHeader
        title="Review queue"
        description="Ambiguous or unusual cases across every run. Deterministic results are never overridden silently."
        actions={
          <div className="segmented">
            <button
              type="button"
              className={status === 'open' ? 'segment active' : 'segment'}
              onClick={() => setStatus('open')}
            >
              Open
            </button>
            <button
              type="button"
              className={status === 'all' ? 'segment active' : 'segment'}
              onClick={() => setStatus('all')}
            >
              All
            </button>
          </div>
        }
      />

      {queue.isLoading ? <LoadingState label="Loading review queue…" /> : null}
      {queue.isError ? (
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
      ) : null}
      {queue.isSuccess && queue.data.items.length === 0 ? (
        <EmptyState
          title={status === 'open' ? 'Nothing to review' : 'No review items yet'}
          description={
            status === 'open'
              ? 'Every account in the latest runs was classified with high confidence.'
              : 'Run the workflow to populate the review queue.'
          }
        />
      ) : null}

      <div className="review-list">
        {queue.data?.items.map((item) => (
          <ReviewItemCard key={item.id} item={item} showRunLink />
        ))}
      </div>
    </div>
  );
}
