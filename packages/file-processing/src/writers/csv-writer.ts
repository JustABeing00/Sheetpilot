import type { Writable } from 'node:stream';
import { stringify } from 'csv-stringify';
import { cellToString, type Row } from '../table.js';
import type { TabularWriter, WriteOptions, WriteResult } from './tabular-writer.js';

export class CsvTabularWriter implements TabularWriter {
  readonly format = 'csv' as const;

  async write(
    rows: Iterable<Row> | AsyncIterable<Row>,
    sink: Writable,
    options: WriteOptions,
  ): Promise<WriteResult> {
    const stringifier = stringify({
      header: true,
      columns: options.columns,
      quoted: true,
      record_delimiter: '\n',
    });

    const finished = new Promise<void>((resolve, reject) => {
      sink.once('finish', () => resolve());
      sink.once('error', reject);
      stringifier.once('error', reject);
    });

    stringifier.pipe(sink);

    let rowCount = 0;
    for await (const row of rows as AsyncIterable<Row>) {
      if (options.signal?.aborted) {
        break;
      }
      stringifier.write(options.columns.map((column) => cellToString(row[column])));
      rowCount += 1;
    }
    stringifier.end();
    await finished;

    return { rowCount, columns: options.columns };
  }
}
