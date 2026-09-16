import type { AiClassificationRequest, AiEventSummary } from '@sheetpilot/core';

/**
 * Controls what leaves the process when a record is sent to an AI provider. Defaults are the safest
 * possible: nothing extra is sent beyond the bounded fields the workflow already selected.
 */
export interface AiRedactionPolicy {
  /** Event/context field names that must never be sent to the provider. */
  excludedFields: string[];
  /** When true, replace the entity identifier with a non-reversible placeholder. */
  redactEntityKey: boolean;
  /** When true, omit the event history and send only the latest event. */
  latestEventOnly: boolean;
}

export const DEFAULT_AI_REDACTION: AiRedactionPolicy = {
  excludedFields: [],
  redactEntityKey: false,
  latestEventOnly: false,
};

export interface RedactedRequest {
  request: AiClassificationRequest;
  redactedFields: string[];
}

function redactEventFields(
  event: AiEventSummary,
  excluded: Set<string>,
  redactedFields: Set<string>,
): AiEventSummary {
  const fields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(event.fields)) {
    if (excluded.has(key)) {
      redactedFields.add(key);
      continue;
    }
    fields[key] = value;
  }
  return { ...event, fields };
}

/**
 * Applies a redaction policy to a request, returning a copy and the names of everything removed so
 * the decision evidence can record that redaction happened.
 */
export function redactClassificationRequest(
  request: AiClassificationRequest,
  policy: AiRedactionPolicy = DEFAULT_AI_REDACTION,
): RedactedRequest {
  const excluded = new Set(policy.excludedFields);
  const redactedFields = new Set<string>();

  const latestEvent = request.latestEvent
    ? redactEventFields(request.latestEvent, excluded, redactedFields)
    : null;

  const eventHistory = policy.latestEventOnly
    ? []
    : request.eventHistory.map((event) => redactEventFields(event, excluded, redactedFields));

  const entityKey = policy.redactEntityKey && request.entityKey ? '[redacted]' : request.entityKey;
  if (policy.redactEntityKey && request.entityKey) {
    redactedFields.add('entityKey');
  }

  return {
    request: {
      ...request,
      entityKey,
      latestEvent,
      eventHistory,
      redactedFields: [...redactedFields],
    },
    redactedFields: [...redactedFields],
  };
}
