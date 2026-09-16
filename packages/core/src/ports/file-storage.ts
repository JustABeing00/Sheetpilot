import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksum: string;
}

export interface StoredObjectInfo extends StoredObject {
  modifiedAt: Date;
}

export interface FileStorage {
  readonly driver: string;
  put(key: string, data: Readable | Buffer | string): Promise<StoredObject>;
  getStream(key: string): Promise<Readable>;
  getBuffer(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /** Lists stored objects (optionally under a key prefix). Used by retention/maintenance jobs. */
  list(prefix?: string): Promise<StoredObjectInfo[]>;
}
