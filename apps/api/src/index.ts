import { APP_NAME, APP_VERSION } from '@sheetpilot/core';
import { loadConfig, loadEnvFiles } from '@sheetpilot/config';
import { createContainer } from './container.js';
import { createLogger } from './logger.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const envFiles = loadEnvFiles();
  const config = loadConfig();
  const logger = createLogger(config);
  const startedAt = Date.now();

  const container = await createContainer(config, logger);
  const app = buildServer(container, { startedAt, loggerInstance: logger });

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
