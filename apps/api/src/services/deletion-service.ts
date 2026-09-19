import {
  ConflictError,
  NotFoundError,
  type Clock,
  type FileStorage,
  type Logger,
  type Repositories,
} from '@sheetpilot/core';

export interface DeletionServiceDeps {
  repositories: Repositories;
  storage: FileStorage;
  clock: Clock;
  logger: Logger;
}

export interface DeleteRunResult {
  runId: string;
  artifactsRemoved: number;
}

/**
 * Data-erasure flows. Deleting a run removes every child row and the generated objects (never the
 * original uploads, which may be referenced by other runs); deleting a dataset is refused while a saved
 * workflow still uses it, then removes the dataset, its file record and the stored object.
 */
export class DeletionService {
  constructor(private readonly deps: DeletionServiceDeps) {}

  async deleteRun(runId: string, tenantId: string | null = null): Promise<DeleteRunResult> {
    const run = await this.deps.repositories.runs.getById(runId);
    if (!run || (tenantId != null && run.tenantId !== tenantId)) {
      throw new NotFoundError('Run', runId);
    }

    const artifacts = await this.deps.repositories.artifacts.listByRun(runId);
    let artifactsRemoved = 0;
    for (const artifact of artifacts) {
      try {
        await this.deps.storage.remove(artifact.storageKey);
        artifactsRemoved += 1;
      } catch (error) {
        this.deps.logger.warn(
          { artifactId: artifact.id, err: error },
          'failed to remove a generated object during run deletion',
        );
      }
    }

    await this.deps.repositories.reviewResolutions.deleteByRun(runId);
    await this.deps.repositories.reviewItems.deleteByRun(runId);
    await this.deps.repositories.decisions.deleteByRun(runId);
    await this.deps.repositories.steps.deleteByRun(runId);
    await this.deps.repositories.runSnapshots.deleteByRun(runId);
    await this.deps.repositories.artifacts.deleteByRun(runId);
    await this.deps.repositories.runs.delete(runId);

    this.deps.logger.info({ runId, artifactsRemoved }, 'run deleted');
    return { runId, artifactsRemoved };
  }

  async deleteDataset(datasetId: string, tenantId: string | null = null): Promise<void> {
    const dataset = await this.deps.repositories.datasets.getById(datasetId);
    if (!dataset || (tenantId != null && dataset.tenantId !== tenantId)) {
      throw new NotFoundError('Dataset', datasetId);
    }

    const configurations = await this.deps.repositories.workflowConfigurations.list({
      tenantId,
      limit: 10_000,
    });
    const referenced = configurations.some(
      (configuration) =>
        configuration.assignments.some((assignment) => assignment.datasetId === datasetId) ||
        configuration.mappings.some((mapping) => mapping.datasetId === datasetId),
    );
    if (referenced) {
      throw new ConflictError(
        'This dataset is used by a saved workflow. Remove it from that workflow before deleting it.',
      );
    }

    const file = await this.deps.repositories.files.getById(dataset.fileId);
    await this.deps.repositories.datasets.delete(datasetId);

    if (file && (tenantId == null || file.tenantId === tenantId)) {
      await this.deps.repositories.files.delete(file.id);
      try {
        await this.deps.storage.remove(file.storageKey);
      } catch (error) {
        this.deps.logger.warn(
          { fileId: file.id, err: error },
          'failed to remove the stored upload during dataset deletion',
        );
      }
    }

    this.deps.logger.info({ datasetId }, 'dataset deleted');
  }
}
