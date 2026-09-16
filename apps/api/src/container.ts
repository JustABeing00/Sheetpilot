import path from 'node:path';
import {
  ConfigurationError,
  storedRuleSetSchema,
  systemClock,
  workflowSchema,
  type ClassificationProvider,
  type Clock,
  type FileStorage,
  type Logger,
  type Repositories,
} from '@sheetpilot/core';
import { createDefaultWorkflowRegistry, type WorkflowRegistry } from '@sheetpilot/workflow-engine';
import { createClassificationProvider } from '@sheetpilot/ai';
import { createPostgresRepositories, createDatabase, type DatabaseHandle } from '@sheetpilot/db';
import { createInMemoryRepositories } from '@sheetpilot/db';
import { LocalFileStorage } from '@sheetpilot/file-processing';
import type { AppConfig } from '@sheetpilot/config';
import { FileService } from './services/file-service.js';
import { DatasetService } from './services/dataset-service.js';
import { ExportService } from './services/export-service.js';
import { ReviewService } from './services/review-service.js';
import { RuleSetService } from './services/rule-set-service.js';
import { RunService } from './services/run-service.js';
import { WorkflowConfigurationService } from './services/workflow-configuration-service.js';

export interface AppContainer {
  config: AppConfig;
  logger: Logger;
  clock: Clock;
  repositories: Repositories;
  storage: FileStorage;
  classifier: ClassificationProvider;
  registry: WorkflowRegistry;
  fileService: FileService;
  datasetService: DatasetService;
  workflowConfigurationService: WorkflowConfigurationService;
  ruleSetService: RuleSetService;
  runService: RunService;
  reviewService: ReviewService;
  exportService: ExportService;
  close(): Promise<void>;
}

async function seedRegisteredWorkflows(
  repositories: Repositories,
  registry: WorkflowRegistry,
  clock: Clock,
  logger: Logger,
): Promise<void> {
  const now = clock.now();

  for (const workflow of registry.list()) {
    const existingWorkflow = await repositories.workflows.getBySlug(workflow.slug);
    await repositories.workflows.upsert(
      workflowSchema.parse({
        id: existingWorkflow?.id ?? `wf-${workflow.slug}`,
        slug: workflow.slug,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        steps: workflow.stepSummaries.map((step) => ({ id: step.id, name: step.name })),
        configFields: [...workflow.configFields],
        createdAt: existingWorkflow?.createdAt ?? now,
        updatedAt: now,
      }),
    );

    const existingRuleSet = await repositories.ruleSets.getActiveByWorkflowSlug(workflow.slug);
    await repositories.ruleSets.upsert(
      storedRuleSetSchema.parse({
        ...workflow.ruleSet,
        id: existingRuleSet?.id ?? `rs-${workflow.ruleSet.slug}`,
        active: true,
        createdAt: existingRuleSet?.createdAt ?? now,
        updatedAt: now,
      }),
    );
  }

  logger.debug({ workflows: registry.list().length }, 'workflow definitions seeded');
}

export async function createContainer(
  config: AppConfig,
  logger: Logger,
  overrides: { storage?: FileStorage; classifier?: ClassificationProvider } = {},
): Promise<AppContainer> {
  const clock = systemClock;
  const storage: FileStorage =
    overrides.storage ?? new LocalFileStorage(path.resolve(config.storage.localDir));

  let databaseHandle: DatabaseHandle | null = null;
  let repositories: Repositories;

  if (config.repository.driver === 'postgres') {
    if (!config.repository.databaseUrl) {
      throw new ConfigurationError('DATABASE_URL is required when REPOSITORY_DRIVER=postgres');
    }
    databaseHandle = createDatabase(config.repository.databaseUrl);
    repositories = createPostgresRepositories(databaseHandle.db);
    logger.info({ driver: 'postgres' }, 'using postgres repositories');
  } else {
    repositories = createInMemoryRepositories();
    logger.warn(
      { driver: 'memory' },
      'using in-memory repositories: data is lost on restart and runs do not survive reloads',
    );
  }

  const classifier =
    overrides.classifier ??
    createClassificationProvider({
      provider: config.ai.provider,
      apiKey: config.ai.apiKey,
      model: config.ai.model,
      baseUrl: config.ai.baseUrl,
      logger,
    });

  const registry = createDefaultWorkflowRegistry({
    files: repositories.files,
    storage,
    classifier,
    logger,
    ai: {
      timeoutMs: config.ai.timeoutMs,
      maxAttempts: config.ai.maxAttempts,
      redaction: { excludedFields: config.ai.excludedFields },
    },
  });
  await seedRegisteredWorkflows(repositories, registry, clock, logger);

  const datasetService = new DatasetService({
    repositories,
    storage,
    clock,
    logger,
    limits: {
      maxUploadBytes: config.storage.maxUploadBytes,
      sampleRows: config.dataset.sampleRows,
      maxScanRows: config.dataset.maxScanRows,
    },
  });
  const fileService = new FileService({ repositories, datasetService });
  const workflowConfigurationService = new WorkflowConfigurationService({
    repositories,
    registry,
    clock,
    logger,
  });
  const ruleSetService = new RuleSetService({ repositories, registry, clock, logger });
  const runService = new RunService({ repositories, storage, registry, clock, logger });
  const reviewService = new ReviewService({ repositories, storage, clock, logger });
  const exportService = new ExportService({ repositories });

  return {
    config,
    logger,
    clock,
    repositories,
    storage,
    classifier,
    registry,
    fileService,
    datasetService,
    workflowConfigurationService,
    ruleSetService,
    runService,
    reviewService,
    exportService,
    async close() {
      await databaseHandle?.close();
    },
  };
}
