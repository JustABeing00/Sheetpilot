import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { StorageError, type FileStorage, type StoredObject } from '@sheetpilot/core';

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

export class InMemoryFileStorage implements FileStorage {
  readonly driver = 'memory';
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, data: Readable | Buffer | string): Promise<StoredObject> {
    const buffer = await toBuffer(data);
    this.objects.set(key, buffer);
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
    const buffer = this.objects.get(key);
    if (!buffer) {
      return Promise.reject(new StorageError(`Stored object '${key}' does not exist`, { key }));
    }
    return Promise.resolve(buffer);
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  get size(): number {
    return this.objects.size;
  }
}
