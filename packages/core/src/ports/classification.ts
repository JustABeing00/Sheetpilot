import {
  aiClassificationRequestSchema,
  aiClassificationResultSchema,
  type AiClassificationRequest,
  type AiClassificationResult,
} from '../domain/ai.js';

/**
 * Provider-neutral classification contract.
 *
 * A provider is a thin, replaceable transport adapter (OpenAI, a local model, a mock): it receives a
 * bounded, structured request and must return a strictly-validated structured result. Provider
 * failures are thrown (see `AiProviderError` in `@sheetpilot/ai`); the orchestration layer is what
 * turns them into a reviewable, non-fatal outcome.
 */
export const classificationRequestSchema = aiClassificationRequestSchema;
export type ClassificationRequest = AiClassificationRequest;

export const classificationResultSchema = aiClassificationResultSchema;
export type ClassificationResult = AiClassificationResult;

export interface ClassificationProvider {
  readonly id: string;
  readonly displayName: string;
  /** Model identifier used for the request, when the provider is model-based. */
  readonly model: string | null;
  isAvailable(): boolean;
  classify(request: ClassificationRequest, signal?: AbortSignal): Promise<ClassificationResult>;
}
