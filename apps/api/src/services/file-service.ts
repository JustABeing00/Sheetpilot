import {
  ConfigurationError,
  type FileAsset,
  type FileKind,
  type Repositories,
} from '@sheetpilot/core';
import type { DatasetService } from './dataset-service.js';

export interface FileServiceDeps {
  repositories: Repositories;
  datasetService: DatasetService;
}

export interface UploadFileInput {
  kind: FileKind;
  originalName: string;
  mimeType: string;
  content: Buffer;
  sheetName?: string;
}

/**
 * Backwards-compatible file endpoint used by the run wizard. Uploading a file is the same operation
 * as ingesting a dataset, so this delegates to {@link DatasetService} and returns the file record.
 */
export class FileService {
  constructor(private readonly deps: FileServiceDeps) {}

  async upload(input: UploadFileInput): Promise<FileAsset> {
    const { file } = await this.deps.datasetService.ingest(input);
    return file;
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
