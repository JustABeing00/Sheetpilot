import { describe, expect, it } from 'vitest';
import { MATCH_ISSUE_CODES, matchRecords } from './index.js';
import type { MatchIssueCode, MatchRecordsOptions } from './types.js';

interface Row {
  id: unknown;
  at?: unknown;
  note: string;
}

function withTimestamp(
  primaries: Row[],
  events: Row[],
  options: Partial<MatchRecordsOptions<Row, Row>> = {},
) {
  return matchRecords<Row, Row>(
    { primaries, events },
    {
      primaryKey: (row) => row.id,
      eventKey: (row) => row.id,
      eventTimestamp: (row) => row.at,
      ...options,
    },
  );
}

function codes(issues: { code: MatchIssueCode }[]): MatchIssueCode[] {
  return issues.map((issue) => issue.code);
}

function latestNote(event: { record: Row }): string {
  return event.record.note;
}

describe('matchRecords', () => {
  it('groups one-to-many events under their entity and selects the latest', () => {
    const result = withTimestamp(
      [{ id: 'A', note: 'primary-a' }],
      [
        { id: 'A', at: '2026-01-01', note: 'old' },
        { id: 'A', at: '2026-03-01', note: 'new' },
        { id: 'A', at: '2026-02-01', note: 'middle' },
      ],
    );

    expect(result.entities).toHaveLength(1);
    const [entity] = result.entities;
    expect(entity?.key).toBe('A');
    expect(entity?.latest?.record.note).toBe('new');
    expect(entity?.events.map(latestNote)).toEqual(['new', 'middle', 'old']);
    expect(entity?.counts).toEqual({
      primaries: 1,
      events: 3,
      eventsWithValidTimestamp: 3,
      eventsWithUnparsedTimestamp: 0,
      eventsWithMissingTimestamp: 0,
    });
    expect(entity?.issues).toEqual([]);
    expect(result.stats.matchedEntities).toBe(1);
    expect(result.stats.entitiesWithMultipleEvents).toBe(1);
  });

  it('keeps the complete history, not just the latest event', () => {
    const result = withTimestamp(
      [{ id: 'A', note: 'primary-a' }],
      [
        { id: 'A', at: '2026-01-01', note: 'one' },
        { id: 'A', at: '2026-02-01', note: 'two' },
        { id: 'A', at: '2026-03-01', note: 'three' },
      ],
    );

    expect(result.entities[0]?.events).toHaveLength(3);
    expect(result.entities[0]?.events.map((event) => event.record.note)).toEqual([
      'three',
      'two',
      'one',
    ]);
  });

  it('reports an entity with zero events without dropping it', () => {
    const result = withTimestamp([{ id: 'A', note: 'primary-a' }], []);

    const [entity] = result.entities;
    expect(entity?.latest).toBeNull();
    expect(entity?.events).toEqual([]);
    expect(codes(entity?.issues ?? [])).toEqual([MATCH_ISSUE_CODES.noEvents]);
    expect(entity?.issues[0]?.severity).toBe('warning');
    expect(result.stats.unmatchedEntities).toBe(1);
    expect(result.stats.matchedEntities).toBe(0);
    expect(result.stats.entitiesWithOneEvent).toBe(0);
  });

  it('tracks orphan events (no matching primary) separately', () => {
    const result = withTimestamp(
      [{ id: 'A', note: 'primary-a' }],
      [
        { id: 'A', at: '2026-01-01', note: 'kept' },
        { id: 'Z', at: '2026-01-01', note: 'orphan-1' },
        { id: 'Z', at: '2026-01-02', note: 'orphan-2' },
        { id: 'Q', at: '2026-01-03', note: 'orphan-3' },
      ],
    );

    expect(result.orphans.map((event) => event.record.note)).toEqual([
      'orphan-1',
      'orphan-2',
      'orphan-3',
    ]);
    expect(result.stats.orphanEventRecords).toBe(3);
    expect(result.stats.orphanEventEntities).toBe(2);
    expect(result.entities.map((entity) => entity.key)).toEqual(['A']);
  });

  it('flags duplicate primary rows and keeps them all', () => {
    const result = withTimestamp(
      [
        { id: 'D', note: 'first' },
        { id: 'D', note: 'second' },
      ],
      [{ id: 'D', at: '2026-01-01', note: 'event' }],
    );

    const [entity] = result.entities;
    expect(entity?.primaries).toHaveLength(2);
    expect(codes(entity?.issues ?? [])).toContain(MATCH_ISSUE_CODES.duplicatePrimary);
    expect(
      entity?.issues.find((issue) => issue.code === MATCH_ISSUE_CODES.duplicatePrimary)?.severity,
    ).toBe('critical');
    expect(result.stats.duplicatePrimaryEntities).toBe(1);
  });

  it('selects the later source row deterministically when the latest timestamps tie', () => {
    const result = withTimestamp(
      [{ id: 'A', note: 'primary' }],
      [
        { id: 'A', at: '2026-05-01T08:00:00Z', note: 'earlier-row' },
        { id: 'A', at: '2026-05-01T08:00:00Z', note: 'later-row' },
        { id: 'A', at: '2026-04-01T00:00:00Z', note: 'older' },
      ],
    );

    const [entity] = result.entities;
    expect(entity?.latest?.record.note).toBe('later-row');
    expect(codes(entity?.issues ?? [])).toContain(MATCH_ISSUE_CODES.ambiguousLatestTimestamp);
    expect(result.stats.ambiguousLatestEntities).toBe(1);
  });

  it('prefers any valid timestamp over an unparseable one', () => {
    const result = withTimestamp(
      [{ id: 'A', note: 'primary' }],
      [
        { id: 'A', at: 'not-a-date', note: 'garbage' },
        { id: 'A', at: '2026-01-01', note: 'valid' },
      ],
    );

    const [entity] = result.entities;
    expect(entity?.latest?.record.note).toBe('valid');
    expect(codes(entity?.issues ?? [])).toContain(MATCH_ISSUE_CODES.unparsedTimestamp);
    expect(entity?.counts.eventsWithUnparsedTimestamp).toBe(1);
    expect(result.stats.malformedTimestamps).toBe(1);
  });

  it('falls back to source order when no event has a valid timestamp', () => {
    const result = withTimestamp(
      [{ id: 'A', note: 'primary' }],
      [
        { id: 'A', at: 'oops', note: 'row-1' },
        { id: 'A', at: 'still-oops', note: 'row-2' },
      ],
    );

    const [entity] = result.entities;
    expect(entity?.latest?.record.note).toBe('row-2');
    expect(codes(entity?.issues ?? [])).toEqual([
      MATCH_ISSUE_CODES.unparsedTimestamp,
      MATCH_ISSUE_CODES.noValidTimestamp,
    ]);
    expect(result.stats.malformedTimestamps).toBe(2);
  });

  it('treats blank timestamps as missing and never lets them beat a real date', () => {
    const result = withTimestamp(
      [{ id: 'A', note: 'primary' }],
      [
        { id: 'A', at: '', note: 'blank' },
        { id: 'A', at: '2026-01-01', note: 'dated' },
        { id: 'A', note: 'absent' },
      ],
    );

    const [entity] = result.entities;
    expect(entity?.latest?.record.note).toBe('dated');
    expect(entity?.counts.eventsWithMissingTimestamp).toBe(2);
    expect(codes(entity?.issues ?? [])).not.toContain(MATCH_ISSUE_CODES.noValidTimestamp);
    expect(result.stats.missingTimestamps).toBe(2);
  });

  it('flags an entity whose events have no usable timestamp at all', () => {
    const result = matchRecords<Row, Row>(
      { primaries: [{ id: 'A', note: 'primary' }], events: [{ id: 'A', note: 'no-time' }] },
      { primaryKey: (row) => row.id, eventKey: (row) => row.id },
    );

    const [entity] = result.entities;
    expect(entity?.latest?.timestampStatus).toBe('missing');
    expect(codes(entity?.issues ?? [])).toEqual([MATCH_ISSUE_CODES.noValidTimestamp]);
  });

  it('matches number and numeric-string identifiers', () => {
    const result = withTimestamp(
      [{ id: 1001, note: 'primary' }],
      [{ id: '1001', at: '2026-01-01', note: 'event' }],
    );

    expect(result.entities[0]?.events).toHaveLength(1);
    expect(result.stats.orphanEventRecords).toBe(0);
  });

  it('matches identifiers that differ only in whitespace and case', () => {
    const result = withTimestamp(
      [{ id: '  north   ridge ', note: 'primary' }],
      [{ id: 'NORTH RIDGE', at: '2026-01-01', note: 'event' }],
    );

    expect(result.entities[0]?.key).toBe('NORTH RIDGE');
    expect(result.entities[0]?.events).toHaveLength(1);
    expect(result.entities[0]?.rawKeys).toEqual(['  north   ridge ', 'NORTH RIDGE']);
  });

  it('skips and counts blank identifiers on both sides', () => {
    const result = withTimestamp(
      [
        { id: 'A', note: 'primary' },
        { id: '  ', note: 'blank-primary' },
      ],
      [
        { id: 'A', at: '2026-01-01', note: 'kept' },
        { id: '', at: '2026-01-01', note: 'blank-event' },
      ],
    );

    expect(result.entities.map((entity) => entity.key)).toEqual(['A']);
    expect(result.stats.primaryRecordsWithoutKey).toBe(1);
    expect(result.stats.eventRecordsWithoutKey).toBe(1);
    expect(result.stats.eventsWithKey).toBe(1);
    expect(result.stats.orphanEventRecords).toBe(0);
  });

  it('only merges dangerous normalizations when opt-in, and flags them', () => {
    const withoutOption = withTimestamp(
      [{ id: '007', note: 'primary' }],
      [{ id: 7, at: '2026-01-01', note: 'event' }],
    );
    expect(withoutOption.stats.orphanEventRecords).toBe(1);
    expect(codes(withoutOption.entities[0]?.issues ?? [])).toEqual([MATCH_ISSUE_CODES.noEvents]);

    const withOption = withTimestamp(
      [{ id: '007', note: 'primary' }],
      [{ id: 7, at: '2026-01-01', note: 'event' }],
      { normalization: { stripLeadingZeros: true } },
    );
    expect(withOption.stats.orphanEventRecords).toBe(0);
    expect(codes(withOption.entities[0]?.issues ?? [])).toContain(
      MATCH_ISSUE_CODES.identifierTransformed,
    );
    expect(withOption.stats.identifierTransformedEntities).toBe(1);
  });

  it('honours the rowIndexBase option', () => {
    const result = withTimestamp([{ id: 'A', note: 'primary' }], [], { rowIndexBase: 5 });
    expect(result.entities[0]?.primaries[0]?.rowIndex).toBe(5);
  });

  it('keeps a stable first-seen entity order regardless of duplicate primary rows', () => {
    const result = withTimestamp(
      [
        { id: 'B', note: 'b1' },
        { id: 'A', note: 'a1' },
        { id: 'B', note: 'b2' },
        { id: 'C', note: 'c1' },
      ],
      [],
    );

    expect(result.entities.map((entity) => entity.key)).toEqual(['B', 'A', 'C']);
    expect(result.entities[0]?.primaries).toHaveLength(2);
  });

  it('forwards the dayFirst option to the timestamp parser', () => {
    const monthFirst = withTimestamp(
      [{ id: 'A', note: 'p' }],
      [
        { id: 'A', at: '03/04/2026', note: 'third-of-april' },
        { id: 'A', at: '02/05/2026', note: 'second-of-may' },
      ],
    );
    expect(monthFirst.entities[0]?.latest?.record.note).toBe('third-of-april');

    const dayFirst = withTimestamp(
      [{ id: 'A', note: 'p' }],
      [
        { id: 'A', at: '03/04/2026', note: 'third-of-april' },
        { id: 'A', at: '02/05/2026', note: 'second-of-may' },
      ],
      { dayFirst: true },
    );
    expect(dayFirst.entities[0]?.latest?.record.note).toBe('second-of-may');
  });

  it('accepts a custom timestamp parser', () => {
    const result = withTimestamp(
      [{ id: 'A', note: 'primary' }],
      [
        { id: 'A', at: 2, note: 'two' },
        { id: 'A', at: 3, note: 'three' },
      ],
      {
        parseTimestamp: (value) => (typeof value === 'number' ? new Date(value) : null),
      },
    );

    expect(result.entities[0]?.latest?.record.note).toBe('three');
    expect(result.entities[0]?.latest?.timestampStatus).toBe('valid');
  });

  it('reports an aggregate summary of the whole join', () => {
    const result = withTimestamp(
      [
        { id: 'A', note: 'a' },
        { id: 'B', note: 'b' },
        { id: 'B', note: 'b2' },
        { id: 'C', note: 'c' },
        { id: '', note: 'blank' },
      ],
      [
        { id: 'A', at: '2026-01-01', note: 'a1' },
        { id: 'A', at: '2026-01-02', note: 'a2' },
        { id: 'B', at: 'not-a-date', note: 'b1' },
        { id: 'Z', at: '2026-01-01', note: 'orphan' },
      ],
    );

    expect(result.stats).toMatchObject({
      primaryRecords: 5,
      eventRecords: 4,
      primaryRecordsWithoutKey: 1,
      eventRecordsWithoutKey: 0,
      entities: 3,
      matchedEntities: 2,
      unmatchedEntities: 1,
      duplicatePrimaryEntities: 1,
      entitiesWithOneEvent: 1,
      entitiesWithMultipleEvents: 1,
      orphanEventRecords: 1,
      orphanEventEntities: 1,
      malformedTimestamps: 1,
      missingTimestamps: 0,
      eventsWithKey: 4,
    });
  });

  it('handles a large dataset with many entities and events', () => {
    const entityCount = 2_000;
    const eventsPerEntity = 5;
    const primaries: Row[] = [];
    const events: Row[] = [];
    for (let entity = 0; entity < entityCount; entity += 1) {
      primaries.push({ id: `ACC-${entity}`, note: `primary-${entity}` });
      for (let event = 0; event < eventsPerEntity; event += 1) {
        events.push({
          id: `ACC-${entity}`,
          at: `2026-01-${String(event + 1).padStart(2, '0')}`,
          note: `event-${entity}-${event}`,
        });
      }
    }

    const startedAt = Date.now();
    const result = withTimestamp(primaries, events);
    const elapsedMs = Date.now() - startedAt;

    expect(result.entities).toHaveLength(entityCount);
    expect(result.stats.matchedEntities).toBe(entityCount);
    expect(result.stats.entitiesWithMultipleEvents).toBe(entityCount);
    expect(result.stats.orphanEventRecords).toBe(0);
    expect(result.entities[1_234]?.latest?.record.note).toBe('event-1234-4');
    // Generous ceiling: the point is that the join stays linear, not a micro-benchmark.
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
