import pino from 'pino';
import { APP_NAME } from '@sheetpilot/core';
import type { AppConfig } from '@sheetpilot/config';

export function createLogger(config: AppConfig): pino.Logger {
  return pino({
    level: config.logLevel,
    base: { app: APP_NAME },
    transport: config.logPretty
      ? {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,app' },
        }
      : undefined,
  });
}
