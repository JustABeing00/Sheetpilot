import { useEffect, useState } from 'react';
import type { StepRunDto } from '@sheetpilot/core';
import { Badge, ProgressBar } from './ui.js';
import { formatDuration } from '../lib/format.js';
import { stepStatusLabel, statusTone } from '../lib/status.js';

interface ExpectedStep {
  id: string;
  name: string;
}

/**
 * A live view of an in-flight run. Steps are only persisted once the run finishes, so the expected
 * pipeline (from the workflow definition) is shown with a pending status and merged with anything the
 * server has already recorded. The elapsed timer keeps ticking so the screen never looks frozen.
 */
export function RunProgress({
  status,
  startedAt,
  expectedSteps,
  recordedSteps,
}: {
  status: string;
  startedAt: string | null;
  expectedSteps: ExpectedStep[];
  recordedSteps: StepRunDto[];
}) {
  const active = status === 'queued' || status === 'running';
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [active]);

  if (!active) {
    return null;
  }

  const recordedById = new Map(recordedSteps.map((step) => [step.stepId, step]));
  const steps: Array<{ id: string; name: string; step: StepRunDto | undefined }> =
    expectedSteps.length > 0
      ? expectedSteps.map((step) => ({ ...step, step: recordedById.get(step.id) }))
      : recordedSteps.map((step) => ({ id: step.stepId, name: step.name, step }));

  const finished = steps.filter(
    (entry) => entry.step && ['succeeded', 'failed', 'skipped'].includes(entry.step.status),
  ).length;
  const elapsedSeconds =
    startedAt === null ? 0 : Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));

  return (
    <div className="run-progress" role="status" aria-live="polite">
      <div className="run-progress-head">
        <strong>{status === 'queued' ? 'Waiting to start…' : 'Processing your files…'}</strong>
        <span className="muted small">
          {elapsedSeconds > 0 ? `Running for ${formatDuration(elapsedSeconds * 1000)}` : 'Starting'}
        </span>
      </div>
      <ProgressBar
        label={`${finished} of ${steps.length} steps complete`}
        value={steps.length > 0 ? (finished / steps.length) * 100 : undefined}
        indeterminate={steps.length === 0}
      />
      {steps.length > 0 ? (
        <ol className="run-progress-steps">
          {steps.map((entry) => (
            <li key={entry.id}>
              <span className="run-progress-dot" aria-hidden="true" />
              <span className="run-progress-name">{entry.name}</span>
              <Badge tone={entry.step ? statusTone(entry.step.status) : 'neutral'}>
                {entry.step ? stepStatusLabel(entry.step.status) : 'Waiting'}
              </Badge>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="muted small">
        This page updates automatically. You can leave and come back — the run continues in the
        background.
      </p>
    </div>
  );
}
