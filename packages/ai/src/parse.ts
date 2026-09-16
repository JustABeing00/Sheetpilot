import { aiClassificationResultSchema, type AiClassificationResult } from '@sheetpilot/core';
import { AiProviderError } from './errors.js';

/**
 * Extracts the first JSON object from a model response. Models sometimes wrap JSON in markdown
 * fences or add a sentence before/after it; we accept the first balanced `{...}` block and reject
 * anything that is not valid JSON.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AiProviderError('AI provider returned an empty response', {
      kind: 'malformed_response',
      retryable: false,
    });
  }

  const start = trimmed.indexOf('{');
  if (start === -1) {
    throw new AiProviderError('AI provider response contained no JSON object', {
      kind: 'malformed_response',
      retryable: false,
    });
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(start, index + 1);
        try {
          return JSON.parse(candidate);
        } catch (error) {
          throw new AiProviderError('AI provider returned malformed JSON', {
            kind: 'malformed_response',
            retryable: false,
            cause: error,
          });
        }
      }
    }
  }

  throw new AiProviderError('AI provider returned an unterminated JSON object', {
    kind: 'malformed_response',
    retryable: false,
  });
}

/**
 * Strictly validates arbitrary provider output against the shared contract. Unknown keys are
 * stripped (never trusted), out-of-range confidences and invalid enums are rejected.
 */
export function parseClassificationResult(raw: unknown): AiClassificationResult {
  const candidate = typeof raw === 'string' ? extractJsonObject(raw) : raw;
  const parsed = aiClassificationResultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AiProviderError('AI provider response did not match the classification schema', {
      kind: 'malformed_response',
      retryable: false,
      cause: parsed.error,
    });
  }
  return parsed.data;
}
