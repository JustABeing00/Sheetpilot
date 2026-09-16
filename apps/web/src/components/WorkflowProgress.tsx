import { Link } from 'react-router-dom';
import { PIPELINE_STAGES, pipelineStateFor, type PipelineStageKey } from '../lib/pipeline.js';

/**
 * A single, consistent progress indicator for the whole product workflow. It shows where the user is in
 * the end-to-end journey and lets them jump back to any earlier stage, so a session can be paused and
 * resumed without losing context.
 */
export function WorkflowProgress({
  current,
  label = 'Your workflow',
}: {
  current: PipelineStageKey;
  label?: string;
}) {
  return (
    <nav className="pipeline" aria-label={label}>
      <span className="pipeline-label">{label}</span>
      <ol className="pipeline-steps">
        {PIPELINE_STAGES.map((stage, index) => {
          const state = pipelineStateFor(stage.key, current);
          return (
            <li key={stage.key} className={`pipeline-step pipeline-step-${state}`}>
              <Link className="pipeline-link" to={stage.to} title={stage.description}>
                <span className="pipeline-marker" aria-hidden="true">
                  {state === 'done' ? '✓' : index + 1}
                </span>
                <span className="pipeline-text">
                  <span className="pipeline-name">{stage.label}</span>
                  <span className="pipeline-info">{stage.description}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <span className="sr-only" aria-live="polite">
        Current step: {PIPELINE_STAGES.find((stage) => stage.key === current)?.label ?? current}
      </span>
    </nav>
  );
}
