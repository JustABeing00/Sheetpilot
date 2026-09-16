import type {
  AiClassificationRequest,
  AiClassificationResult,
  ClassificationProvider,
} from '@sheetpilot/core';

/**
 * The default provider. It reports itself unavailable, so the pipeline never sends data anywhere;
 * every classification is fully deterministic.
 */
export class NoopClassificationProvider implements ClassificationProvider {
  readonly id = 'noop';
  readonly displayName = 'No AI provider configured';
  readonly model = null;

  isAvailable(): boolean {
    return false;
  }

  classify(
    _request: AiClassificationRequest,
    _signal?: AbortSignal,
  ): Promise<AiClassificationResult> {
    return Promise.resolve({
      proposedCode: null,
      proposedLabel: '',
      confidence: 0,
      reasoning: '',
      ambiguity: [],
      missingInformation: [],
    });
  }
}
