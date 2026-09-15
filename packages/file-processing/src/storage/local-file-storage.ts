import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StorageError, type FileStorage, type StoredObject } from '@sheetpilot/core';

function isReadable(value: unknown): value is Readable {
  return value instanceof Readable;
}

export class LocalFileStorage implements FileStorage {
  readonly driver = 'local';

  constructor(private readonly rootDir: string) {}

  private resolvePath(key: string): string {
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.length === 0 || normalized.split('/').includes('..')) {
      throw new StorageError(`Invalid storage key '${key}'`, { key });
    }
    return path.join(this.rootDir, normalized);
  }

  async put(key: string, data: Readable | Buffer | string): Promise<StoredObject> {
    const target = this.resolvePath(key);
    await mkdir(path.dirname(target), { recursive: true });

    if (isReadable(data)) {
      const hash = createHash('sha256');
      let sizeBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          sizeBytes += chunk.length;
          callback(null, chunk);
        },
      });
      await pipeline(data, meter, createWriteStream(target));
      return { key, sizeBytes, checksum: hash.digest('hex') };
    }

    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    await writeFile(target, buffer);
    return {
      key,
      sizeBytes: buffer.length,
      checksum: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  async getStream(key: string): Promise<Readable> {
    const target = this.resolvePath(key);
    try {
      await stat(target);
    } catch (error) {
      throw new StorageError(`Stored object '${key}' does not exist`, { key }, error);
    }
    return createReadStream(target);
  }

  async getBuffer(key: string): Promise<Buffer> {
    const target = this.resolvePath(key);
    try {
      return await readFile(target);
    } catch (error) {
      throw new StorageError(`Stored object '${key}' does not exist`, { key }, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.resolvePath(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }
}
