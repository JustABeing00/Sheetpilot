import { parseTimestamp as parseCellTimestamp, type CellValue } from '@sheetpilot/file-processing';
import { normalizeIdentifier, renderCellText } from './normalize.js';
import {
  MATCH_ISSUE_CODES,
  type IdentifierTransformation,
  type MatchIssue,
  type MatchedEntity,
  type MatchedEvent,
  type MatchedPrimary,
  type MatchRecordsInput,
  type MatchRecordsOptions,
  type MatchResult,
  type MatchStats,
  type TimestampStatus,
} from './types.js';

interface MutableEntity<TPrimary, TEvent> {
  key: string;
  rawKeySet: Set<string>;
  rawKeys: string[];
  primaries: MatchedPrimary<TPrimary>[];
  events: MatchedEvent<TEvent>[];
}

function toCellValue(value: unknown): CellValue | undefined {
  if (value === undefined || value === null) {
    return value ?? null;
  }
  if (value instanceof Date) {
    return value;
  }
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') {
    return value as CellValue;
  }
  return renderCellText(value);
}

function addRawKey<TPrimary, TEvent>(entity: MutableEntity<TPrimary, TEvent>, raw: string): void {
  if (raw.length > 0 && !entity.rawKeySet.has(raw)) {
    entity.rawKeySet.add(raw);
    entity.rawKeys.push(raw);
  }
}

function makeIssue(
  code: MatchIssue['code'],
  severity: MatchIssue['severity'],
  detail: string,
): MatchIssue {
  return { code, severity, detail };
}

/**
 * Orders events so the latest comes first: valid timestamps descending, then unparseable/missing
 * timestamps, with the later source row winning any tie. This is the deterministic contract the
 * whole engine (and anything consuming `entities[].events`) relies on.
 */
export function compareEventsLatestFirst<TEvent>(
  left: MatchedEvent<TEvent>,
  right: MatchedEvent<TEvent>,
): number {
  const leftTime = left.timestamp === null ? null : left.timestamp.getTime();
  const rightTime = right.timestamp === null ? null : right.timestamp.getTime();
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  if (leftTime !== null && rightTime === null) {
    return -1;
  }
  if (leftTime === null && rightTime !== null) {
    return 1;
  }
  return right.rowIndex - left.rowIndex;
}

function hasAmbiguousLatest<TEvent>(events: MatchedEvent<TEvent>[]): boolean {
  const [first, second] = events;
  if (!first || !second || first.timestamp === null || second.timestamp === null) {
    return false;
  }
  return first.timestamp.getTime() === second.timestamp.getTime();
}

function hasDangerous(transformations: IdentifierTransformation[]): boolean {
  return transformations.some((entry) => entry.dangerous);
}

/**
 * Joins primary records to their event records and produces the normalized intermediate
 * representation downstream classification consumes.
 *
 * Complexity is O(P + E + Σ eᵢ log eᵢ) where P/E are the record counts and eᵢ is the number of
 * events for entity i. Every map/array decision is order-independent: entities keep first-seen
 * primary order and event ties break on source row, so the output is fully deterministic.
 */
export function matchRecords<TPrimary, TEvent>(
  input: MatchRecordsInput<TPrimary, TEvent>,
  options: MatchRecordsOptions<TPrimary, TEvent>,
): MatchResult<TPrimary, TEvent> {
  const rowIndexBase = options.rowIndexBase ?? 2;
  const dayFirst = options.dayFirst ?? false;
  const parse =
    options.parseTimestamp ??
    ((value: unknown, settings: { dayFirst: boolean }): Date | null =>
      parseCellTimestamp(toCellValue(value), { dayFirst: settings.dayFirst }));

  const entityByKey = new Map<string, MutableEntity<TPrimary, TEvent>>();
  const entities: MutableEntity<TPrimary, TEvent>[] = [];
  let primaryRecordsWithoutKey = 0;

  input.primaries.forEach((record, index) => {
    const normalized = normalizeIdentifier(
      options.primaryKey(record, index),
      options.normalization,
    );
    if (normalized.key.length === 0) {
      primaryRecordsWithoutKey += 1;
      return;
    }
    let entity = entityByKey.get(normalized.key);
    if (!entity) {
      entity = {
        key: normalized.key,
        rawKeySet: new Set(),
        rawKeys: [],
        primaries: [],
        events: [],
      };
      entityByKey.set(normalized.key, entity);
      entities.push(entity);
    }
    addRawKey(entity, normalized.raw);
    entity.primaries.push({
      index,
      rowIndex: rowIndexBase + index,
      key: normalized.key,
      rawKey: normalized.raw,
      transformations: normalized.transformations,
      record,
    });
  });

  const orphans: MatchedEvent<TEvent>[] = [];
  let eventRecordsWithoutKey = 0;
  let eventsWithKey = 0;
  let malformedTimestamps = 0;
  let missingTimestamps = 0;

  input.events.forEach((record, index) => {
    const normalized = normalizeIdentifier(options.eventKey(record, index), options.normalization);
    if (normalized.key.length === 0) {
      eventRecordsWithoutKey += 1;
      return;
    }
    eventsWithKey += 1;

    const timestampValue = options.eventTimestamp?.(record, index);
    const timestampRaw = renderCellText(timestampValue);
    const parsed = options.eventTimestamp ? parse(timestampValue, { dayFirst }) : null;
    let timestampStatus: TimestampStatus;
    if (timestampRaw.length === 0) {
      timestampStatus = 'missing';
      missingTimestamps += 1;
    } else if (parsed === null) {
      timestampStatus = 'unparsed';
      malformedTimestamps += 1;
    } else {
      timestampStatus = 'valid';
    }

    const matched: MatchedEvent<TEvent> = {
      index,
      rowIndex: rowIndexBase + index,
      key: normalized.key,
      rawKey: normalized.raw,
      transformations: normalized.transformations,
      timestamp: parsed,
      timestampRaw,
      timestampStatus,
      record,
    };

    const entity = entityByKey.get(normalized.key);
    if (entity) {
      addRawKey(entity, normalized.raw);
      entity.events.push(matched);
    } else {
      orphans.push(matched);
    }
  });

  const resultEntities: MatchedEntity<TPrimary, TEvent>[] = entities.map((entity) => {
    const events = [...entity.events].sort(compareEventsLatestFirst);
    const latest = events[0] ?? null;

    const eventsWithValidTimestamp = events.filter(
      (event) => event.timestampStatus === 'valid',
    ).length;
    const eventsWithUnparsedTimestamp = events.filter(
      (event) => event.timestampStatus === 'unparsed',
    ).length;
    const eventsWithMissingTimestamp = events.filter(
      (event) => event.timestampStatus === 'missing',
    ).length;

    const issues: MatchIssue[] = [];
    if (events.length === 0) {
      issues.push(
        makeIssue(MATCH_ISSUE_CODES.noEvents, 'warning', 'No event records matched this entity.'),
      );
    }
    if (entity.primaries.length > 1) {
      issues.push(
        makeIssue(
          MATCH_ISSUE_CODES.duplicatePrimary,
          'critical',
          `Entity appears ${entity.primaries.length} times in the primary records.`,
        ),
      );
    }
    if (eventsWithUnparsedTimestamp > 0) {
      issues.push(
        makeIssue(
          MATCH_ISSUE_CODES.unparsedTimestamp,
          'warning',
          `${eventsWithUnparsedTimestamp} event timestamp(s) could not be parsed.`,
        ),
      );
    }
    if (events.length > 0 && eventsWithValidTimestamp === 0) {
      issues.push(
        makeIssue(
          MATCH_ISSUE_CODES.noValidTimestamp,
          'warning',
          'No event has a valid timestamp; the latest event was chosen by source order.',
        ),
      );
    }
    if (hasAmbiguousLatest(events)) {
      issues.push(
        makeIssue(
          MATCH_ISSUE_CODES.ambiguousLatestTimestamp,
          'warning',
          'Multiple events share the latest timestamp.',
        ),
      );
    }
    const dangerous =
      entity.primaries.some((entry) => hasDangerous(entry.transformations)) ||
      events.some((entry) => hasDangerous(entry.transformations));
    if (dangerous) {
      issues.push(
        makeIssue(
          MATCH_ISSUE_CODES.identifierTransformed,
          'warning',
          'A dangerous identifier normalization changed this entity key.',
        ),
      );
    }

    return {
      key: entity.key,
      rawKeys: entity.rawKeys,
      primaries: entity.primaries,
      events,
      latest,
      issues,
      counts: {
        primaries: entity.primaries.length,
        events: events.length,
        eventsWithValidTimestamp,
        eventsWithUnparsedTimestamp,
        eventsWithMissingTimestamp,
      },
    };
  });

  const orphanEventEntities = new Set(orphans.map((event) => event.key)).size;
  const matchedEntities = resultEntities.filter((entity) => entity.events.length > 0).length;
  const hasIssue = (entity: MatchedEntity<TPrimary, TEvent>, code: string): boolean =>
    entity.issues.some((issue) => issue.code === code);

  const stats: MatchStats = {
    primaryRecords: input.primaries.length,
    eventRecords: input.events.length,
    primaryRecordsWithoutKey,
    eventRecordsWithoutKey,
    entities: resultEntities.length,
    matchedEntities,
    unmatchedEntities: resultEntities.length - matchedEntities,
    duplicatePrimaryEntities: resultEntities.filter((entity) => entity.primaries.length > 1).length,
    entitiesWithOneEvent: resultEntities.filter((entity) => entity.events.length === 1).length,
    entitiesWithMultipleEvents: resultEntities.filter((entity) => entity.events.length > 1).length,
    orphanEventRecords: orphans.length,
    orphanEventEntities,
    malformedTimestamps,
    missingTimestamps,
    eventsWithKey,
    ambiguousLatestEntities: resultEntities.filter((entity) =>
      hasIssue(entity, MATCH_ISSUE_CODES.ambiguousLatestTimestamp),
    ).length,
    identifierTransformedEntities: resultEntities.filter((entity) =>
      hasIssue(entity, MATCH_ISSUE_CODES.identifierTransformed),
    ).length,
  };

  return { entities: resultEntities, orphans, stats };
}
