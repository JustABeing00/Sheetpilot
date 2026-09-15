import { Writable } from 'node:stream';
import type { Row } from '../table.js';
import type { TabularWriter, WriteOptions, WriteResult } from './tabular-writer.js';

export async function writeTableToBuffer(
  writer: TabularWriter,
  rows: Iterable<Row> | AsyncIterable<Row>,
  options: WriteOptions,
): Promise<{ buffer: Buffer; result: WriteResult }> {
  const chunks: Buffer[] = [];
  const collector = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      callback();
    },
  });

  const result = await writer.write(rows, collector, options);
  return { buffer: Buffer.concat(chunks), result };
}
