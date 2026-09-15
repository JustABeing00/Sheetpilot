import path from 'node:path';
import {
  ConfigurationError,
  fileAssetSchema,
  newId,
  UnsupportedFormatError,
  type Clock,
  type FileAsset,
  type FileKind,
  type FileStorage,
  type Logger,
  type Repositories,
} from '@sheetpilot/core';
import {
  countRows,
  createTabularReader,
  detectTabularFormat,
  readAllRows,
} from '@sheetpilot/file-processing';

export interface FileServiceDeps {
  repositories: Repositories;
  storage: FileStorage;
  clock: Clock;
  logger: Logger;
}

export interface UploadFileInput {
  kind: FileKind;
  originalName: string;
  mimeType: string;
  content: Buffer;
}

export class FileService {
  constructor(private readonly deps: FileServiceDeps) {}

  async upload(input: UploadFileInput): Promise<FileAsset> {
    const format = detectTabularFormat(input.originalName, input.content.subarray(0, 4096));
    if (!format) {
      throw new UnsupportedFormatError(
        `Unsupported file type for "${path.basename(input.originalName)}". Upload a .csv or .xlsx file.`,
        { fileName: input.originalName },
      );
    }

    const id = newId();
    const storageKey = `uploads/${format}/${id}.${format}`;
    const stored = await this.deps.storage.put(storageKey, input.content);

    const preview = await readAllRows(
      createTabularReader(format),
      await this.deps.storage.getStream(stored.key),
      { limit: 200 },
    );
    const rowCount = await countRows(
      createTabularReader(format),
      await this.deps.storage.getStream(stored.key),
    );

    if (preview.columns.length === 0) {
      throw new UnsupportedFormatError(
        `File "${path.basename(input.originalName)}" does not contain a header row with column names.`,
        { fileName: input.originalName },
      );
    }

    const asset = fileAssetSchema.parse({
      id,
      kind: input.kind,
      originalName: path.basename(input.originalName),
      format,
      mimeType: input.mimeType.length > 0 ? input.mimeType : 'application/octet-stream',
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      rowCount,
      columnNames: preview.columns,
      storageKey: stored.key,
      uploadedAt: this.deps.clock.now(),
    });

    const saved = await this.deps.repositories.files.create(asset);
    this.deps.logger.info(
      { fileId: saved.id, format: saved.format, rowCount: saved.rowCount, kind: saved.kind },
      'file uploaded',
    );
    return saved;
  }

  async getById(id: string): Promise<FileAsset | null> {
    return this.deps.repositories.files.getById(id);
  }

  async list(limit = 100): Promise<FileAsset[]> {
    return this.deps.repositories.files.list(limit);
  }
}

export function assertStorageConfigured(driver: string): void {
  if (driver !== 'local') {
    throw new ConfigurationError(`Storage driver '${driver}' is not supported yet`, { driver });
  }
}
