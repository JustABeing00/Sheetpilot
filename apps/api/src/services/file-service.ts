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

  async upload(input: UploadFileInput, tenantId: string | null = null): Promise<FileAsset> {
    const { file } = await this.deps.datasetService.ingest(input, tenantId);
    return file;
  }

  async getById(id: string, tenantId: string | null = null): Promise<FileAsset | null> {
    const file = await this.deps.repositories.files.getById(id);
    if (!file || (tenantId != null && file.tenantId !== tenantId)) {
      return null;
    }
    return file;
  }

  async list(limit = 100, tenantId: string | null = null): Promise<FileAsset[]> {
    return this.deps.repositories.files.list({ limit, tenantId });
  }
}

export function assertStorageConfigured(driver: string): void {
  if (driver !== 'local') {
    throw new ConfigurationError(`Storage driver '${driver}' is not supported yet`, { driver });
  }
}
