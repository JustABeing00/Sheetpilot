import pino from 'pino';
import { APP_NAME } from '@sheetpilot/core';
import type { AppConfig } from '@sheetpilot/config';

/**
 * Paths scrubbed from every log line before it is written. Uploaded file *contents* are never logged
 * in the first place; this guards the other common leak: credentials and headers that a framework or
 * dependency might attach to a log object.
 */
const REDACT_PATHS = [
  'apiKey',
  'api_key',
  'password',
  'secret',
  'token',
  'authorization',
  'Authorization',
  'OPENAI_API_KEY',
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers["x-api-key"]',
  '*.apiKey',
  '*.password',
  '*.token',
];

export function createLogger(config: AppConfig): pino.Logger {
  return pino({
    level: config.logLevel,
    base: { app: APP_NAME },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    transport: config.logPretty
      ? {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,app' },
        }
      : undefined,
  });
}
