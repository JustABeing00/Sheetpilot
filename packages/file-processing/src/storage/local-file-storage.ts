import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  StorageError,
  type FileStorage,
  type StoredObject,
  type StoredObjectInfo,
} from '@sheetpilot/core';

function isReadable(value: unknown): value is Readable {
  return value instanceof Readable;
}

export class LocalFileStorage implements FileStorage {
  readonly driver = 'local';
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  /**
   * Maps an internal storage key onto an absolute path and proves the result stays inside the storage
   * root. Storage keys are generated from internal ids, but this is a defence-in-depth check against
   * traversal (`..`), absolute paths, drive-relative paths (`C:foo`), NUL bytes and empty segments.
   */
  private resolvePath(key: string): string {
    if (typeof key !== 'string' || key.length === 0 || key.includes('\0')) {
      throw new StorageError(`Invalid storage key '${key}'`, { key });
    }

    // Reject absolute/drive-relative keys outright rather than silently rebasing them under the root.
    if (/^[/\\]/.test(key) || /^[a-zA-Z]:/.test(key)) {
      throw new StorageError(`Storage key '${key}' must be relative`, { key });
    }

    const normalized = key.replace(/\\/g, '/');
    const segments = normalized.split('/');
    if (
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      normalized.includes(':')
    ) {
      throw new StorageError(`Invalid storage key '${key}'`, { key });
    }

    const resolved = path.resolve(this.rootDir, normalized);
    const relative = path.relative(this.rootDir, resolved);
    if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new StorageError(`Storage key '${key}' escapes the storage root`, { key });
    }
    return resolved;
  }

  /** Lists stored objects (optionally under a key prefix), newest metadata included. */
  async list(prefix?: string): Promise<StoredObjectInfo[]> {
    const results: StoredObjectInfo[] = [];
    const walk = async (absoluteDir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(absoluteDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const absolute = path.join(absoluteDir, entry.name);
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const key = path.relative(this.rootDir, absolute).split(path.sep).join('/');
        if (prefix && !key.startsWith(prefix)) {
          continue;
        }
        try {
          const info = await stat(absolute);
          results.push({ key, sizeBytes: info.size, checksum: '', modifiedAt: info.mtime });
        } catch {
          // The object disappeared between listing and stat; skip it.
        }
      }
    };
    await walk(this.rootDir);
    return results;
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
