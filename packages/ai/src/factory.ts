import type { AiProviderId, ClassificationProvider, Logger } from '@sheetpilot/core';
import { ConfigurationError } from '@sheetpilot/core';
import { NoopClassificationProvider } from './noop-provider.js';

export interface AiProviderConfig {
  provider: AiProviderId;
  apiKey: string | null;
  model: string | null;
  logger?: Logger;
}

export function createClassificationProvider(config: AiProviderConfig): ClassificationProvider {
  switch (config.provider) {
    case 'noop':
      return new NoopClassificationProvider();
    case 'openai':
      throw new ConfigurationError(
        'AI provider "openai" is not implemented yet. Set AI_PROVIDER=noop until the OpenAI adapter lands.',
        { provider: 'openai' },
      );
  }
}
