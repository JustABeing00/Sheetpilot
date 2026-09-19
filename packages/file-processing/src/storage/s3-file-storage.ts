import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  StorageError,
  type FileStorage,
  type StoredObject,
  type StoredObjectInfo,
} from '@sheetpilot/core';

export interface S3FileStorageOptions {
  bucket: string;
  region: string;
  endpoint?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  forcePathStyle?: boolean;
}

function isReadable(value: unknown): value is Readable {
  return value instanceof Readable;
}

/** Rejects keys that are empty, absolute, or contain traversal/NUL — defence in depth for object keys. */
function assertSafeKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.includes('\0')) {
    throw new StorageError(`Invalid storage key '${key}'`, { key });
  }
  if (/^[/\\]/.test(key) || /^[a-zA-Z]:/.test(key)) {
    throw new StorageError(`Storage key '${key}' must be relative`, { key });
  }
  const segments = key.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new StorageError(`Invalid storage key '${key}'`, { key });
  }
  if (/\s/.test(key)) {
    throw new StorageError(`Storage key '${key}' must not contain whitespace`, { key });
  }
}

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, …). This is the driver that lets the API
 * and the worker share files (and lets the API scale past one instance) without a local volume.
 */
export class S3FileStorage implements FileStorage {
  readonly driver = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3FileStorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.accessKeyId && options.secretAccessKey
        ? {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }
        : {}),
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
    });
  }

  async put(key: string, data: Readable | Buffer | string): Promise<StoredObject> {
    assertSafeKey(key);
    const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

    if (isReadable(body)) {
      const hash = createHash('sha256');
      let sizeBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          sizeBytes += chunk.length;
          callback(null, chunk);
        },
      });
      body.pipe(meter);
      const upload = new Upload({
        client: this.client,
        params: { Bucket: this.bucket, Key: key, Body: meter },
      });
      await upload.done();
      return { key, sizeBytes, checksum: hash.digest('hex') };
    }

    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body },
    }).done();
    return {
      key,
      sizeBytes: body.length,
      checksum: createHash('sha256').update(body).digest('hex'),
    };
  }

  async getStream(key: string): Promise<Readable> {
    assertSafeKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new StorageError(`Stored object '${key}' does not exist`, { key });
    }
    return response.Body as Readable;
  }

  async getBuffer(key: string): Promise<Buffer> {
    return streamToBuffer(await this.getStream(key));
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix?: string): Promise<StoredObjectInfo[]> {
    const results: StoredObjectInfo[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (!object.Key) {
          continue;
        }
        results.push({
          key: object.Key,
          sizeBytes: object.Size ?? 0,
          checksum: '',
          modifiedAt: object.LastModified ?? new Date(0),
        });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return results;
  }
}
