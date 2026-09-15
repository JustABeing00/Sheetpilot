import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import type { Row } from '../table.js';
import type { ReadOptions, TabularReader } from './tabular-reader.js';

export class CsvTabularReader implements TabularReader {
  readonly format = 'csv' as const;

  async *read(source: Readable, options: ReadOptions = {}): AsyncGenerator<Row> {
    const parser = source.pipe(
      parse({
        bom: true,
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        trim: false,
        cast: false,
      }),
    );

    let emitted = 0;
    try {
      for await (const record of parser) {
        if (options.signal?.aborted) {
          break;
        }
        const row: Row = {};
        for (const [key, value] of Object.entries(record as Record<string, string | undefined>)) {
          row[key] = value === undefined ? null : value;
        }
        yield row;
        emitted += 1;
        if (options.limit !== undefined && emitted >= options.limit) {
          break;
        }
      }
    } finally {
      parser.destroy();
    }
  }
}
