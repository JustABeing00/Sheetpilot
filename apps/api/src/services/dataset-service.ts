import type { Readable } from 'node:stream';
import {
  CorruptFileError,
  datasetProfileSchema,
  fileAssetSchema,
  newId,
  NotFoundError,
  toDatasetSummary,
  type Clock,
  type DatasetAnalysis,
  type DatasetProfile,
  type DatasetSummary,
  type FileAsset,
  type FileKind,
  type FileStorage,
  type Logger,
  type Repositories,
} from '@sheetpilot/core';
import {
  assertWorkbookArchiveSafe,
  cellToString,
  createTabularReader,
  inspectDataset,
  validateUpload,
  type Row,
} from '@sheetpilot/file-processing';

export interface DatasetServiceDeps {
  repositories: Repositories;
  storage: FileStorage;
  clock: Clock;
  logger: Logger;
  limits: {
    maxUploadBytes: number;
    maxXlsxUncompressedBytes: number;
    maxXlsxEntries: number;
    sampleRows: number;
    maxScanRows: number;
  };
}

export interface IngestDatasetInput {
  kind: FileKind;
  originalName: string;
  mimeType: string;
  content: Buffer;
  sheetName?: string;
}

export interface IngestedDataset {
  file: FileAsset;
  dataset: DatasetProfile;
}

export interface ReadDatasetRowsInput {
  datasetId: string;
  sheetName?: string;
  limit: number;
  offset: number;
}

export interface DatasetRowPage {
  datasetId: string;
  sheetName: string | null;
  columns: string[];
  items: Array<Record<string, string>>;
  total: number | null;
  limit: number;
  offset: number;
  hasMore: boolean;
}

function dedupeHeaders(headers: string[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const raw of headers) {
    const name = raw.trim();
    if (name.length === 0 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    columns.push(name);
  }
  return columns;
}

function stringifyRow(row: Row, columns: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const column of columns) {
    result[column] = cellToString(row[column]);
  }
  return result;
}

/**
 * Owns the ingestion pipeline: validate → store → inspect → persist. Rows always stay in object
 * storage; only bounded samples and aggregate statistics are persisted or returned.
 */
export class DatasetService {
  constructor(private readonly deps: DatasetServiceDeps) {}

  async ingest(
    input: IngestDatasetInput,
    tenantId: string | null = null,
  ): Promise<IngestedDataset> {
    const validated = validateUpload(
      {
        fileName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.content.length,
        head: input.content.subarray(0, 4096),
      },
      { maxBytes: this.deps.limits.maxUploadBytes },
    );

    // Untrusted workbooks are checked for decompression-bomb shape before they reach the parser
    // (which buffers the whole workbook). Rejecting here avoids an out-of-memory before the reader
    // can fail cleanly.
    if (validated.format === 'xlsx') {
      assertWorkbookArchiveSafe(input.content, validated.fileName, {
        maxEntries: this.deps.limits.maxXlsxEntries,
        maxUncompressedBytes: this.deps.limits.maxXlsxUncompressedBytes,
      });
    }

    const datasetId = newId();
    const storageKey = `uploads/${validated.format}/${datasetId}.${validated.format}`;

    // Once stored, any later failure must not leave an orphaned object behind: a rejected or corrupt
    // upload is deleted rather than accumulating on disk.
    try {
      const stored = await this.deps.storage.put(storageKey, input.content);

      const analysis = await inspectDataset({
        reader: createTabularReader(validated.format),
        openStream: () => this.deps.storage.getStream(stored.key),
        sheetName: input.sheetName,
        sampleRows: this.deps.limits.sampleRows,
        maxScanRows: this.deps.limits.maxScanRows,
      });

      const file = await this.deps.repositories.files.create(
        fileAssetSchema.parse({
          id: newId(),
          tenantId,
          kind: input.kind,
          originalName: validated.fileName,
          format: validated.format,
          mimeType: validated.mimeType,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          rowCount: analysis.rowCount,
          columnNames: analysis.columns.map((column) => column.name),
          storageKey: stored.key,
          uploadedAt: this.deps.clock.now(),
        }),
      );

      const dataset = await this.deps.repositories.datasets.create(
        datasetProfileSchema.parse({
          id: datasetId,
          tenantId,
          fileId: file.id,
          kind: input.kind,
          originalName: validated.fileName,
          format: validated.format,
          mimeType: validated.mimeType,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          inspectedAt: this.deps.clock.now(),
          ...analysis,
        }),
      );

      this.deps.logger.info(
        {
          datasetId: dataset.id,
          fileId: file.id,
          format: dataset.format,
          rowCount: dataset.rowCount,
          columnCount: dataset.columns.length,
          warnings: dataset.warnings.length,
          truncated: dataset.truncated,
        },
        'dataset ingested',
      );

      return { file, dataset };
    } catch (error) {
      await this.cleanupStoredObject(storageKey, error);
      throw error;
    }
  }

  /** Best-effort removal of a stored upload after a failed ingestion; never masks the original error. */
  private async cleanupStoredObject(storageKey: string, cause: unknown): Promise<void> {
    try {
      await this.deps.storage.remove(storageKey);
    } catch (cleanupError) {
      this.deps.logger.warn(
        { storageKey, err: cleanupError, cause: cause instanceof Error ? cause.message : cause },
        'failed to clean up rejected upload',
      );
    }
  }

  async getById(id: string, tenantId: string | null = null): Promise<DatasetProfile> {
    const dataset = await this.deps.repositories.datasets.getById(id);
    if (!dataset || (tenantId != null && dataset.tenantId !== tenantId)) {
      throw new NotFoundError('Dataset', id);
    }
    return dataset;
  }

  async list(limit = 100, offset = 0, tenantId: string | null = null): Promise<DatasetSummary[]> {
    const datasets = await this.deps.repositories.datasets.list({ limit, offset, tenantId });
    return datasets.map(toDatasetSummary);
  }

  async analyze(
    datasetId: string,
    sheetName?: string,
    tenantId: string | null = null,
  ): Promise<DatasetAnalysis> {
    const dataset = await this.getById(datasetId, tenantId);
    const file = await this.requireFile(dataset);

    return inspectDataset({
      reader: createTabularReader(dataset.format),
      openStream: () => this.deps.storage.getStream(file.storageKey),
      sheetName,
      sampleRows: this.deps.limits.sampleRows,
      maxScanRows: this.deps.limits.maxScanRows,
    });
  }

  async readRows(
    input: ReadDatasetRowsInput,
    tenantId: string | null = null,
  ): Promise<DatasetRowPage> {
    const dataset = await this.getById(input.datasetId, tenantId);
    const file = await this.requireFile(dataset);
    const sheetName = input.sheetName ?? dataset.sheetName ?? undefined;
    const reader = createTabularReader(dataset.format);

    let columns: string[];
    try {
      const description = await reader.describe(await this.open(file), { sheetName });
      columns = dedupeHeaders(description.headers);
    } catch (error) {
      throw new CorruptFileError(
        'The stored dataset could not be read.',
        { datasetId: dataset.id },
        error,
      );
    }

    const items: Array<Record<string, string>> = [];
    let skipped = 0;
    let hasMore = false;

    try {
      for await (const row of reader.read(await this.open(file), { sheetName })) {
        if (skipped < input.offset) {
          skipped += 1;
          continue;
        }
        if (items.length >= input.limit) {
          hasMore = true;
          break;
        }
        items.push(stringifyRow(row, columns));
      }
    } catch (error) {
      throw new CorruptFileError(
        'The stored dataset could not be read.',
        { datasetId: dataset.id },
        error,
      );
    }

    return {
      datasetId: dataset.id,
      sheetName: sheetName ?? null,
      columns,
      items,
      total: sheetName === (dataset.sheetName ?? undefined) ? dataset.rowCount : null,
      limit: input.limit,
      offset: input.offset,
      hasMore,
    };
  }

  private open(file: FileAsset): Promise<Readable> {
    return this.deps.storage.getStream(file.storageKey);
  }

  private async requireFile(dataset: DatasetProfile): Promise<FileAsset> {
    const file = await this.deps.repositories.files.getById(dataset.fileId);
    if (!file) {
      throw new NotFoundError('File', dataset.fileId);
    }
    return file;
  }
}
