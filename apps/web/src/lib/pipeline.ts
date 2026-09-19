export type PipelineStageKey = 'setup' | 'rules' | 'processing' | 'review' | 'export';

export interface PipelineStage {
  key: PipelineStageKey;
  /** Plain-language name of the step in the end-to-end journey. */
  label: string;
  /** Where the user goes to work on this step. */
  to: string;
  /** One sentence explaining what happens here, in business terms. */
  description: string;
}

/**
 * The end-to-end journey a user follows: prepare the setup, tune the rules, process the files, handle the
 * exceptions, then download the finished report. Every stage is a real, resumable place in the app, so a
 * user can leave and come back without losing work.
 */
export const PIPELINE_STAGES: PipelineStage[] = [
  {
    key: 'setup',
    label: 'Set up',
    to: '/setup',
    description: 'Connect the files and confirm which columns mean what.',
  },
  {
    key: 'rules',
    label: 'Rules',
    to: '/rules',
    description: 'Review the business rules that classify each record.',
  },
  {
    key: 'processing',
    label: 'Process',
    to: '/runs',
    description: 'Run the workflow to classify every record and produce the report.',
  },
  {
    key: 'review',
    label: 'Review',
    to: '/review',
    description: 'A person decides the few unusual cases.',
  },
  {
    key: 'export',
    label: 'Export',
    to: '/runs',
    description: 'Download the finished Excel or CSV report.',
  },
];

export function pipelineStageIndex(key: PipelineStageKey): number {
  const index = PIPELINE_STAGES.findIndex((stage) => stage.key === key);
  return index < 0 ? 0 : index;
}

export type PipelineStageState = 'done' | 'current' | 'upcoming';

export function pipelineStateFor(
  step: PipelineStageKey,
  current: PipelineStageKey,
): PipelineStageState {
  const stepIndex = pipelineStageIndex(step);
  const currentIndex = pipelineStageIndex(current);
  if (stepIndex === currentIndex) {
    return 'current';
  }
  return stepIndex < currentIndex ? 'done' : 'upcoming';
}
