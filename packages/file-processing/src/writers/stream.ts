import { PassThrough } from 'node:stream';
import type { FileStorage, StoredObject } from '@sheetpilot/core';
import type { Row } from '../table.js';
import type { TabularWriter, WriteOptions, WriteResult } from './tabular-writer.js';

export interface WriteToStorageResult {
  stored: StoredObject;
  result: WriteResult;
}

/**
 * Writes a table straight into {@link FileStorage} through a pipeline, so the generated file is
 * never materialised as one giant Buffer in the process (the previous collect-and-concat approach
 * held both the chunk list and the concatenated copy at once). The writer still streams row by row;
 * only a bounded PassThrough buffer sits in between.
 */
export async function writeTableToStorage(
  writer: TabularWriter,
  rows: Iterable<Row> | AsyncIterable<Row>,
  options: WriteOptions,
  storage: FileStorage,
  key: string,
): Promise<WriteToStorageResult> {
  const sink = new PassThrough();
  const stored = storage.put(key, sink);

  try {
    const result = await writer.write(rows, sink, options);
    return { stored: await stored, result };
  } catch (error) {
    // The writer never finished the sink, so the storage pipeline would otherwise hang.
    sink.destroy(error instanceof Error ? error : undefined);
    await stored.catch(() => undefined);
    throw error;
  }
}
