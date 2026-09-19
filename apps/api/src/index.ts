import { APP_NAME, APP_VERSION } from '@sheetpilot/core';
import { loadConfig, loadEnvFiles, type AppConfig } from '@sheetpilot/config';
import { createDatabase, runMigrations } from '@sheetpilot/db';
import { createContainer } from './container.js';
import { createLogger } from './logger.js';
import { buildServer } from './server.js';
import { RunDispatcher } from './services/run-dispatcher.js';

/**
 * `node dist/index.js --migrate` applies pending Drizzle migrations and exits. This is the production
 * migration path: it needs no TypeScript toolchain and runs from the same bundle as the server.
 */
async function runMigrationsCli(config: AppConfig, logger: ReturnType<typeof createLogger>) {
  if (!config.repository.databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  const handle = createDatabase(config.repository.databaseUrl);
  try {
    await runMigrations(handle.db, {
      migrationsFolder: config.repository.migrationsDir ?? undefined,
      logger,
    });
    logger.info('database migrations applied');
  } finally {
    await handle.close();
  }
}

/**
 * `node dist/index.js --worker` runs a dedicated run executor: no HTTP server, just the durable queue.
 * This is the process that lets the API scale horizontally without executing runs itself.
 */
async function runWorker(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const container = await createContainer(config, logger);
  if (!container.dispatcher) {
    logger.warn(
      'RUN_DISPATCH_IN_PROCESS=false, so this worker would never claim jobs; enabling an in-process dispatcher for this process',
    );
  }
  const dispatcher =
    container.dispatcher ??
    new RunDispatcher({
      queue: container.queue,
      runService: container.runService,
      logger,
      pollIntervalMs: config.run.pollIntervalMs,
      staleLockMs: config.run.staleLockMs,
      retryDelayMs: config.run.retryDelayMs,
    });

  await dispatcher.recoverStale();
  dispatcher.start();
  logger.info(
    { queue: container.queue.driver, pollIntervalMs: config.run.pollIntervalMs },
    `${APP_NAME} run worker started`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker shutting down');
    try {
      await dispatcher.stop();
      await container.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

async function main(): Promise<void> {
  const envFiles = loadEnvFiles();
  const config = loadConfig();
  const logger = createLogger(config);
  const startedAt = Date.now();

  if (process.argv.includes('--migrate')) {
    await runMigrationsCli(config, logger);
    return;
  }

  if (process.argv.includes('--worker')) {
    await runWorker(config, logger);
    return;
  }

  const container = await createContainer(config, logger);
  const app = buildServer(container, { startedAt, loggerInstance: logger });

  try {
    await container.retentionService.sweep();
    container.retentionService.start();
  } catch (error) {
    logger.warn({ err: error }, 'initial retention sweep failed');
  }

  if (container.inboxService) {
    try {
      await container.inboxService.start();
    } catch (error) {
      logger.warn({ err: error }, 'inbox watcher failed to start');
    }
  }

  if (!config.security.apiKey) {
    logger.warn(
      'API_KEY is not set: the API has no authentication and must only be reachable from a trusted network',
    );
  }
  if (config.isProduction && config.security.allowInsecure) {
    logger.warn(
      'ALLOW_INSECURE=true: production safety checks are disabled (in-memory persistence and/or no API key)',
    );
  }
  if (config.isProduction && config.corsOrigins.includes('http://localhost:5173')) {
    logger.warn('CORS_ORIGIN still allows the development origin in production');
  }

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info(
      { envFiles, port: config.port, host: config.host, version: APP_VERSION },
      `${APP_NAME} API started`,
    );
  } catch (error) {
    logger.error({ err: error }, 'failed to start API server');
    await container.close();
    process.exitCode = 1;
    return;
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      await container.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  console.error('Fatal startup error', error);
  process.exitCode = 1;
});
