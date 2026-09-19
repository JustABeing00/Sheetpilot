import path from 'node:path';
import type { AuthConfig } from '@auth/core';
import type { FastifyRequest } from 'fastify';
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
import {
  createPostgresRepositories,
  createDatabase,
  runMigrations,
  type DatabaseHandle,
} from '@sheetpilot/db';
import { createInMemoryRepositories } from '@sheetpilot/db';
import { LocalFileStorage } from '@sheetpilot/file-processing';
import type { AppConfig } from '@sheetpilot/config';
import { buildAuthConfig } from './auth/config.js';
import { readSession } from './auth/session.js';
import type { AuthUser } from './auth/types.js';
import { FileService } from './services/file-service.js';
import { DatasetService } from './services/dataset-service.js';
import { TenancyService } from './services/tenancy-service.js';
import { ExportService } from './services/export-service.js';
import { IdempotencyService } from './services/idempotency-service.js';
import { InboxService } from './services/inbox-service.js';
import { RetentionService } from './services/retention-service.js';
import { ReviewService } from './services/review-service.js';
import { RuleSetService } from './services/rule-set-service.js';
import { RunService } from './services/run-service.js';
import { SavedWorkflowService } from './services/saved-workflow-service.js';
import { WorkflowConfigurationService } from './services/workflow-configuration-service.js';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

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
  savedWorkflowService: SavedWorkflowService;
  retentionService: RetentionService;
  inboxService: InboxService | null;
  idempotency: IdempotencyService;
  auth: {
    enabled: boolean;
    config: AuthConfig | null;
    tenancy: TenancyService;
  };
  /** Resolves the authenticated user + active tenant from the session cookie, or null. */
  authenticate(request: FastifyRequest): Promise<AuthUser | null>;
  /** Resolves when the backing store is reachable; throws otherwise. Used by the readiness probe. */
  readiness(): Promise<void>;
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

    // Seed the workflow's default rule set only on a genuinely empty install. Rules are user-managed
    // data: upserting the in-code default over an existing set would silently discard a customized or
    // replaced active set on every restart (a real data-loss bug with a persistent database).
    const existingRuleSets = await repositories.ruleSets.listByWorkflowSlug(workflow.slug);
    if (existingRuleSets.length === 0) {
      await repositories.ruleSets.upsert(
        storedRuleSetSchema.parse({
          ...workflow.ruleSet,
          id: `rs-${workflow.ruleSet.slug}`,
          active: true,
          createdAt: now,
          updatedAt: now,
        }),
      );
    } else {
      logger.debug(
        { workflowSlug: workflow.slug, ruleSets: existingRuleSets.length },
        'workflow already has rule sets; leaving them untouched',
      );
    }
  }

  logger.debug({ workflows: registry.list().length }, 'workflow definitions seeded');
}

export async function createContainer(
  config: AppConfig,
  logger: Logger,
  overrides: {
    storage?: FileStorage;
    classifier?: ClassificationProvider;
    /** Inject an existing repository set (tests that need data to survive a container re-creation). */
    repositories?: Repositories;
  } = {},
): Promise<AppContainer> {
  const clock = systemClock;
  const storage: FileStorage =
    overrides.storage ?? new LocalFileStorage(path.resolve(config.storage.localDir));

  let databaseHandle: DatabaseHandle | null = null;
  let repositories: Repositories;

  if (overrides.repositories) {
    repositories = overrides.repositories;
  } else if (config.repository.driver === 'postgres') {
    if (!config.repository.databaseUrl) {
      throw new ConfigurationError('DATABASE_URL is required when REPOSITORY_DRIVER=postgres');
    }
    databaseHandle = createDatabase(config.repository.databaseUrl);
    if (config.repository.autoMigrate) {
      await runMigrations(databaseHandle.db, {
        migrationsFolder: config.repository.migrationsDir ?? undefined,
        logger,
      });
    }
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
      maxXlsxUncompressedBytes: config.storage.maxXlsxUncompressedBytes,
      maxXlsxEntries: config.storage.maxXlsxEntries,
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
  const retentionService = new RetentionService({
    storage,
    repositories,
    clock,
    logger,
    uploadTtlMs: config.retention.uploadTtlMs,
    sweepIntervalMs: config.retention.sweepIntervalMs,
  });
  const idempotency = new IdempotencyService(IDEMPOTENCY_TTL_MS, clock);

  const tenancyService = new TenancyService({
    repositories,
    clock,
    logger,
    bootstrapTenantName: config.auth.bootstrapTenantName,
  });

  let authConfig: AuthConfig | null = null;
  if (config.auth.enabled) {
    if (!databaseHandle) {
      throw new ConfigurationError(
        'AUTH_ENABLED=true requires REPOSITORY_DRIVER=postgres (sessions and users are persisted)',
      );
    }
    authConfig = buildAuthConfig(config, databaseHandle.db, {
      onUserCreated: async (user) => {
        if (!user.id) {
          return;
        }
        await tenancyService.ensurePersonalTenant(user.id, user.name ?? user.email ?? null);
      },
    });
    await tenancyService.ensureBootstrapTenant();
  }

  const authenticate = async (request: FastifyRequest): Promise<AuthUser | null> => {
    if (!authConfig) {
      return null;
    }
    const claims = await readSession(request, config);
    if (!claims) {
      return null;
    }
    const tenantId = await tenancyService.ensurePersonalTenant(
      claims.userId,
      claims.name ?? claims.email,
    );
    return { id: claims.userId, email: claims.email, name: claims.name, tenantId };
  };

  // A restart strands in-flight runs (they execute in-process). Mark them failed now so the UI never
  // shows a phantom "processing" run.
  await runService.recoverStaleRuns();
  const savedWorkflowService = new SavedWorkflowService({
    repositories,
    registry,
    clock,
    logger,
    configurationService: workflowConfigurationService,
    runService,
    exportService,
  });

  const inboxService =
    config.inbox.enabled && config.inbox.configurationId
      ? new InboxService({
          dir: path.resolve(config.inbox.dir),
          configurationId: config.inbox.configurationId,
          primaryPattern: config.inbox.primaryPattern,
          eventsPattern: config.inbox.eventsPattern,
          pollIntervalMs: config.inbox.pollIntervalMs,
          settleMs: config.inbox.settleMs,
          datasetService,
          savedWorkflowService,
          repositories,
          clock,
          logger,
        })
      : null;

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
    savedWorkflowService,
    retentionService,
    inboxService,
    idempotency,
    auth: {
      enabled: config.auth.enabled,
      config: authConfig,
      tenancy: tenancyService,
    },
    authenticate,
    async readiness() {
      await databaseHandle?.ping();
    },
    async close() {
      retentionService.stop();
      inboxService?.stop();
      await databaseHandle?.close();
    },
  };
}
