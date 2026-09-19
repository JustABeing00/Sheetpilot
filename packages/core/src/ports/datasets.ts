import type { DatasetId, DatasetProfile } from '../domain/dataset.js';

export interface DatasetListOptions {
  /** Restrict to one tenant. Omitted only for legacy/single-tenant (auth disabled) callers. */
  tenantId?: string | null;
  limit?: number;
  offset?: number;
}

export interface DatasetRepository {
  create(dataset: DatasetProfile): Promise<DatasetProfile>;
  getById(id: DatasetId): Promise<DatasetProfile | null>;
  list(options?: DatasetListOptions): Promise<DatasetProfile[]>;
}
