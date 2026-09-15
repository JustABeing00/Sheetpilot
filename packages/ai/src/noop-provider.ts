import type {
  ClassificationRequest,
  ClassificationSuggestion,
  ClassificationProvider,
} from '@sheetpilot/core';

export class NoopClassificationProvider implements ClassificationProvider {
  readonly id = 'noop';
  readonly displayName = 'No AI provider configured';

  isAvailable(): boolean {
    return false;
  }

  classify(
    _request: ClassificationRequest,
    _signal?: AbortSignal,
  ): Promise<ClassificationSuggestion[]> {
    return Promise.resolve([]);
  }
}
