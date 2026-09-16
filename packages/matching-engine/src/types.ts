/**
 * Public contract of `@sheetpilot/matching-engine`.
 *
 * The engine joins a set of *primary* records (one row per entity) to a set of *event* records
 * (zero or many rows per entity) using a normalized identifier, groups the events per entity and
 * selects the latest event deterministically. It is deliberately generic: it never knows about
 * accounts, faults or any specific workflow, and it operates on the in-memory arrays a load step
 * has already produced. Downstream classification consumes the normalized `MatchedEntity`
 * representation instead of re-deriving joins or "latest" logic itself.
 */

/** One documented step applied while deriving a comparison key from a raw identifier. */
export interface IdentifierTransformation {
  code: IdentifierTransformationCode;
  /**
   * `true` when the step can merge identifiers that a human would consider distinct
   * (for example stripping leading zeros or separators). Dangerous steps are opt-in only.
   */
  dangerous: boolean;
}

export type IdentifierTransformationCode =
  | 'normalize-non-breaking-space'
  | 'trim'
  | 'collapse-whitespace'
  | 'upper-case'
  | 'coerce-number'
  | 'strip-separators'
  | 'strip-leading-zeros';

export interface IdentifierNormalizationOptions {
  /** Collapse the non-breaking space (U+00A0) to a normal space. Default `true`. */
  normalizeNonBreakingSpace?: boolean;
  /** Trim leading/trailing whitespace. Default `true`. */
  trim?: boolean;
  /** Collapse runs of whitespace to a single space. Default `true`. */
  collapseWhitespace?: boolean;
  /** Case-fold to upper case. Default `true`. */
  upperCase?: boolean;
  /** Remove spaces, dashes, dots, slashes and underscores. Default `false`. DANGEROUS. */
  stripSeparators?: boolean;
  /** Remove leading zeros from numeric identifiers (`"007"` → `"7"`). Default `false`. DANGEROUS. */
  stripLeadingZeros?: boolean;
}

export interface NormalizedIdentifier {
  /** The raw identifier rendered as text, before any transformation. */
  raw: string;
  /** The comparison key. Empty string means the value was blank and is not matchable. */
  key: string;
  /** The transformations that actually changed the value, in application order. */
  transformations: IdentifierTransformation[];
  /** `true` when at least one dangerous transformation changed the value. */
  dangerous: boolean;
}

export type TimestampStatus = 'valid' | 'missing' | 'unparsed';

export const MATCH_ISSUE_CODES = {
  noEvents: 'no_events',
  duplicatePrimary: 'duplicate_primary',
  ambiguousLatestTimestamp: 'ambiguous_latest_timestamp',
  unparsedTimestamp: 'unparsed_timestamp',
  noValidTimestamp: 'no_valid_timestamp',
  identifierTransformed: 'identifier_transformed',
} as const;

export type MatchIssueCode = (typeof MATCH_ISSUE_CODES)[keyof typeof MATCH_ISSUE_CODES];

export interface MatchIssue {
  code: MatchIssueCode;
  severity: 'info' | 'warning' | 'critical';
  detail: string;
}

/** A primary input record, wrapped with its normalized key and source position. */
export interface MatchedPrimary<TRecord> {
  /** 0-based index into the primary input array. */
  index: number;
  /** 1-based row number in the source file (`rowIndexBase + index`). */
  rowIndex: number;
  key: string;
  rawKey: string;
  transformations: IdentifierTransformation[];
  record: TRecord;
}

/** An event input record, wrapped with its normalized key, timestamp and source position. */
export interface MatchedEvent<TRecord> {
  /** 0-based index into the event input array. */
  index: number;
  /** 1-based row number in the source file (`rowIndexBase + index`). */
  rowIndex: number;
  key: string;
  rawKey: string;
  transformations: IdentifierTransformation[];
  /** Parsed timestamp, or `null` when missing/unparseable. */
  timestamp: Date | null;
  /** The raw timestamp rendered as text. Empty when the value was blank. */
  timestampRaw: string;
  timestampStatus: TimestampStatus;
  record: TRecord;
}

/**
 * One entity: every primary record that shares a normalized key, plus the complete, deterministically
 * ordered event history. `events[0]` is always the latest event (when events exist).
 */
export interface MatchedEntity<TPrimary, TEvent> {
  /** Normalized identifier used to join primary and event records. */
  key: string;
  /** Distinct raw identifier spellings observed for this entity, in first-seen order. */
  rawKeys: string[];
  primaries: MatchedPrimary<TPrimary>[];
  /** Complete event history, ordered latest-first (ties: later source row first). */
  events: MatchedEvent<TEvent>[];
  latest: MatchedEvent<TEvent> | null;
  issues: MatchIssue[];
  counts: {
    primaries: number;
    events: number;
    eventsWithValidTimestamp: number;
    eventsWithUnparsedTimestamp: number;
    eventsWithMissingTimestamp: number;
  };
}

export interface MatchStats {
  primaryRecords: number;
  eventRecords: number;
  /** Primary rows whose identifier was blank and therefore skipped. */
  primaryRecordsWithoutKey: number;
  /** Event rows whose identifier was blank and therefore skipped. */
  eventRecordsWithoutKey: number;
  /** Distinct primary entities (matched and unmatched). */
  entities: number;
  /** Entities with at least one event. */
  matchedEntities: number;
  /** Entities with zero events. */
  unmatchedEntities: number;
  /** Entities that appear more than once in the primary input. */
  duplicatePrimaryEntities: number;
  entitiesWithOneEvent: number;
  entitiesWithMultipleEvents: number;
  /** Event rows whose identifier matched no primary entity. */
  orphanEventRecords: number;
  /** Distinct identifiers among the orphan event rows. */
  orphanEventEntities: number;
  /** Events with a non-empty but unparseable timestamp. */
  malformedTimestamps: number;
  /** Events with a blank timestamp. */
  missingTimestamps: number;
  /** Events that carried a usable (non-blank) identifier. */
  eventsWithKey: number;
  ambiguousLatestEntities: number;
  identifierTransformedEntities: number;
}

export interface MatchResult<TPrimary, TEvent> {
  /** Entities in first-seen primary order. */
  entities: MatchedEntity<TPrimary, TEvent>[];
  /** Events that matched no primary entity, in first-seen source order. */
  orphans: MatchedEvent<TEvent>[];
  stats: MatchStats;
}

export interface MatchRecordsInput<TPrimary, TEvent> {
  primaries: readonly TPrimary[];
  events: readonly TEvent[];
}

export interface MatchRecordsOptions<TPrimary, TEvent> {
  /** Extracts the raw primary identifier from a record. */
  primaryKey: (record: TPrimary, index: number) => unknown;
  /** Extracts the raw event identifier from a record. */
  eventKey: (record: TEvent, index: number) => unknown;
  /** Extracts the raw event timestamp. Omit when events have no timestamps. */
  eventTimestamp?: (record: TEvent, index: number) => unknown;
  /** Identifier normalization options applied before comparison. */
  normalization?: IdentifierNormalizationOptions;
  /** Interpret ambiguous dates (`03/04/2026`) as day-first. Default `false`. */
  dayFirst?: boolean;
  /** 1-based row number of the first data record. Default `2` (one header row). */
  rowIndexBase?: number;
  /** Override the timestamp parser (tests / other formats). */
  parseTimestamp?: (value: unknown, options: { dayFirst: boolean }) => Date | null;
}
