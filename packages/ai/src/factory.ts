import type { AiProviderId, ClassificationProvider, Logger } from '@sheetpilot/core';
import { ConfigurationError } from '@sheetpilot/core';
import { NoopClassificationProvider } from './noop-provider.js';
import { OpenAiClassificationProvider, type FetchLike } from './openai-provider.js';

export interface AiProviderConfig {
  provider: AiProviderId;
  apiKey: string | null;
  model: string | null;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  logger?: Logger;
}

/**
 * Builds the configured provider. Only the transport adapter is selected here; orchestration
 * (policy, timeout, retries, redaction) lives in `AiClassificationService` and is provider-neutral.
 */
export function createClassificationProvider(config: AiProviderConfig): ClassificationProvider {
  switch (config.provider) {
    case 'noop':
      return new NoopClassificationProvider();
    case 'openai': {
      if (!config.apiKey || !config.model) {
        throw new ConfigurationError(
          'The openai provider requires OPENAI_API_KEY and AI_MODEL to be configured.',
          { provider: 'openai' },
        );
      }
      return new OpenAiClassificationProvider({
        apiKey: config.apiKey,
        model: config.model,
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      });
    }
  }
}
