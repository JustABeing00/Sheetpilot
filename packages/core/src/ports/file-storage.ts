import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksum: string;
}

export interface FileStorage {
  readonly driver: string;
  put(key: string, data: Readable | Buffer | string): Promise<StoredObject>;
  getStream(key: string): Promise<Readable>;
  getBuffer(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}
