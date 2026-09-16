import { matchRecords } from '../src/index.js';

interface BenchmarkRow {
  id: string;
  at: string;
}

function buildDataset(
  entities: number,
  eventsPerEntity: number,
): {
  primaries: BenchmarkRow[];
  events: BenchmarkRow[];
} {
  const primaries: BenchmarkRow[] = [];
  const events: BenchmarkRow[] = [];
  for (let entity = 0; entity < entities; entity += 1) {
    primaries.push({ id: `ACC-${entity}`, at: '' });
    for (let event = 0; event < eventsPerEntity; event += 1) {
      events.push({
        id: `ACC-${entity}`,
        at: `2026-01-${String((event % 28) + 1).padStart(2, '0')}`,
      });
    }
  }
  return { primaries, events };
}

function run(entities: number, eventsPerEntity: number): void {
  const { primaries, events } = buildDataset(entities, eventsPerEntity);
  const startedAt = performance.now();
  const result = matchRecords<BenchmarkRow, BenchmarkRow>(
    { primaries, events },
    {
      primaryKey: (row) => row.id,
      eventKey: (row) => row.id,
      eventTimestamp: (row) => row.at,
    },
  );
  const elapsed = performance.now() - startedAt;
  const perSecond = Math.round((result.stats.eventRecords / elapsed) * 1000);
  console.log(
    [
      `${entities.toLocaleString()} entities`,
      `${events.length.toLocaleString()} events`,
      `${elapsed.toFixed(1)} ms`,
      `${perSecond.toLocaleString()} events/s`,
      `matched=${result.stats.matchedEntities.toLocaleString()}`,
      `orphans=${result.stats.orphanEventRecords}`,
    ].join('  |  '),
  );
}

console.log('@sheetpilot/matching-engine benchmark');
run(10_000, 3);
run(50_000, 3);
run(100_000, 5);
run(250_000, 4);
