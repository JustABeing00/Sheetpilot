import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnvFile } from 'dotenv';
import { z } from 'zod';
import {
  aiProviderIdSchema as coreAiProviderIdSchema,
  ConfigurationError,
  formatZodError,
  type AiProviderId as CoreAiProviderId,
} from '@sheetpilot/core';

export const nodeEnvSchema = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.infer<typeof nodeEnvSchema>;

export const logLevelSchema = z.enum([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const repositoryDriverSchema = z.enum(['memory', 'postgres']);
export type RepositoryDriver = z.infer<typeof repositoryDriverSchema>;

export const storageDriverSchema = z.enum(['local']);
export type StorageDriver = z.infer<typeof storageDriverSchema>;

export const aiProviderIdSchema = coreAiProviderIdSchema;
export type AiProviderId = CoreAiProviderId;

export const envSourceSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: logLevelSchema.default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  REPOSITORY_DRIVER: repositoryDriverSchema.default('memory'),
  DATABASE_URL: z.string().default(''),
  STORAGE_DRIVER: storageDriverSchema.default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('.data/storage'),
  MAX_UPLOAD_MB: z.coerce.number().min(0.1).max(1024).default(50),
  DATASET_SAMPLE_ROWS: z.coerce.number().int().min(1).max(500).default(10),
  DATASET_MAX_SCAN_ROWS: z.coerce.number().int().min(100).max(5_000_000).default(200_000),
  AI_PROVIDER: aiProviderIdSchema.default('noop'),
  OPENAI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default(''),
});
export type EnvSource = z.infer<typeof envSourceSchema>;

export interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  host: string;
  port: number;
  logLevel: LogLevel;
  logPretty: boolean;
  corsOrigins: string[];
  repository: {
    driver: RepositoryDriver;
    databaseUrl: string | null;
  };
  storage: {
    driver: StorageDriver;
    localDir: string;
    maxUploadBytes: number;
  };
  dataset: {
    sampleRows: number;
    maxScanRows: number;
  };
  ai: {
    provider: AiProviderId;
    apiKey: string | null;
    model: string | null;
    configured: boolean;
  };
}

export function loadEnvFiles(startDir = process.cwd(), maxLevels = 3): string[] {
  const loaded: string[] = [];
  let current = path.resolve(startDir);
  for (let level = 0; level < maxLevels; level += 1) {
    const candidate = path.join(current, '.env');
    if (existsSync(candidate)) {
      loadEnvFile({ path: candidate });
      loaded.push(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return loaded;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSourceSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigurationError(
      `Invalid environment configuration: ${formatZodError(parsed.error)}`,
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String),
          message: issue.message,
        })),
      },
    );
  }

  const source = parsed.data;

  if (source.REPOSITORY_DRIVER === 'postgres') {
    if (source.DATABASE_URL.trim().length === 0) {
      throw new ConfigurationError('DATABASE_URL is required when REPOSITORY_DRIVER=postgres', {
        variable: 'DATABASE_URL',
      });
    }
    if (!/^postgres(ql)?:\/\//.test(source.DATABASE_URL)) {
      throw new ConfigurationError('DATABASE_URL must be a postgres:// connection string', {
        variable: 'DATABASE_URL',
      });
    }
  }

  if (source.AI_PROVIDER === 'openai' && source.OPENAI_API_KEY.trim().length === 0) {
    throw new ConfigurationError('OPENAI_API_KEY is required when AI_PROVIDER=openai', {
      variable: 'OPENAI_API_KEY',
    });
  }

  const corsOrigins = source.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    nodeEnv: source.NODE_ENV,
    isProduction: source.NODE_ENV === 'production',
    host: source.API_HOST,
    port: source.API_PORT,
    logLevel: source.LOG_LEVEL,
    logPretty: source.LOG_PRETTY,
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : ['http://localhost:5173'],
    repository: {
      driver: source.REPOSITORY_DRIVER,
      databaseUrl: source.DATABASE_URL.trim().length > 0 ? source.DATABASE_URL : null,
    },
    storage: {
      driver: source.STORAGE_DRIVER,
      localDir: source.STORAGE_LOCAL_DIR,
      maxUploadBytes: Math.round(source.MAX_UPLOAD_MB * 1024 * 1024),
    },
    dataset: {
      sampleRows: source.DATASET_SAMPLE_ROWS,
      maxScanRows: source.DATASET_MAX_SCAN_ROWS,
    },
    ai: {
      provider: source.AI_PROVIDER,
      apiKey: source.OPENAI_API_KEY.trim().length > 0 ? source.OPENAI_API_KEY : null,
      model: source.AI_MODEL.trim().length > 0 ? source.AI_MODEL : null,
      configured: source.AI_PROVIDER === 'openai' && source.OPENAI_API_KEY.trim().length > 0,
    },
  };
}
