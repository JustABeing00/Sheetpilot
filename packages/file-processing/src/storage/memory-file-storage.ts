import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  StorageError,
  type FileStorage,
  type StoredObject,
  type StoredObjectInfo,
} from '@sheetpilot/core';

async function toBuffer(data: Readable | Buffer | string): Promise<Buffer> {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of data) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

interface MemoryObject {
  buffer: Buffer;
  modifiedAt: Date;
}

export class InMemoryFileStorage implements FileStorage {
  readonly driver = 'memory';
  private readonly objects = new Map<string, MemoryObject>();
  private readonly clock: () => Date;

  constructor(options: { clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  async put(key: string, data: Readable | Buffer | string): Promise<StoredObject> {
    const buffer = await toBuffer(data);
    this.objects.set(key, { buffer, modifiedAt: this.clock() });
    return {
      key,
      sizeBytes: buffer.length,
      checksum: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  getStream(key: string): Promise<Readable> {
    return this.getBuffer(key).then((buffer) => Readable.from([buffer]));
  }

  getBuffer(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) {
      return Promise.reject(new StorageError(`Stored object '${key}' does not exist`, { key }));
    }
    return Promise.resolve(object.buffer);
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  list(prefix?: string): Promise<StoredObjectInfo[]> {
    const items: StoredObjectInfo[] = [];
    for (const [key, object] of this.objects) {
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }
      items.push({
        key,
        sizeBytes: object.buffer.length,
        checksum: createHash('sha256').update(object.buffer).digest('hex'),
        modifiedAt: object.modifiedAt,
      });
    }
    return Promise.resolve(items);
  }

  get size(): number {
    return this.objects.size;
  }
}
