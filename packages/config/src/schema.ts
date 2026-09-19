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
  // API_PORT wins when set; otherwise the platform-provided PORT (Render, Heroku, Fly, ...) is used.
  API_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  LOG_LEVEL: logLevelSchema.default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  REPOSITORY_DRIVER: repositoryDriverSchema.default('memory'),
  DATABASE_URL: z.string().default(''),
  // Apply pending Drizzle migrations at API startup (single-instance deployments only).
  DB_AUTO_MIGRATE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Explicit path to the Drizzle SQL folder when it is not resolvable from the running file.
  DB_MIGRATIONS_DIR: z.string().default(''),
  STORAGE_DRIVER: storageDriverSchema.default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('.data/storage'),
  MAX_UPLOAD_MB: z.coerce.number().min(0.1).max(1024).default(50),
  JSON_BODY_LIMIT_MB: z.coerce.number().min(0.1).max(100).default(2),
  MAX_XLSX_UNCOMPRESSED_MB: z.coerce.number().min(1).max(4096).default(512),
  MAX_XLSX_ENTRIES: z.coerce.number().int().min(100).max(200_000).default(20_000),
  RETENTION_UPLOAD_TTL_HOURS: z.coerce.number().min(0.1).max(8760).default(168),
  RETENTION_SWEEP_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  DATASET_SAMPLE_ROWS: z.coerce.number().int().min(1).max(500).default(10),
  DATASET_MAX_SCAN_ROWS: z.coerce.number().int().min(100).max(5_000_000).default(200_000),
  API_KEY: z.string().default(''),
  // Escape hatch: allow production to start with the in-memory driver and/or no API key.
  ALLOW_INSECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(0).max(1_000_000).default(600),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  AI_PROVIDER: aiProviderIdSchema.default('noop'),
  OPENAI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default(''),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
  AI_EXCLUDED_FIELDS: z.string().default(''),
  AUTH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  AUTH_SECRET: z.string().default(''),
  AUTH_URL: z.string().default(''),
  AUTH_TRUST_HOST: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  AUTH_GOOGLE_ID: z.string().default(''),
  AUTH_GOOGLE_SECRET: z.string().default(''),
  AUTH_GITHUB_ID: z.string().default(''),
  AUTH_GITHUB_SECRET: z.string().default(''),
  AUTH_RESEND_KEY: z.string().default(''),
  AUTH_EMAIL_FROM: z.string().default(''),
  BOOTSTRAP_TENANT_NAME: z.string().min(1).default('SheetPilot'),
  INBOX_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  INBOX_DIR: z.string().default(''),
  INBOX_CONFIGURATION_ID: z.string().default(''),
  INBOX_PRIMARY_PATTERN: z.string().min(1).default('primary.*'),
  INBOX_EVENTS_PATTERN: z.string().min(1).default('events.*'),
  INBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(15_000),
  INBOX_SETTLE_MS: z.coerce.number().int().min(0).max(3_600_000).default(3_000),
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
    autoMigrate: boolean;
    migrationsDir: string | null;
  };
  storage: {
    driver: StorageDriver;
    localDir: string;
    maxUploadBytes: number;
    maxXlsxUncompressedBytes: number;
    maxXlsxEntries: number;
  };
  security: {
    /** When set, every /api/v1 route (except the health probes) requires an `x-api-key` header. */
    apiKey: string | null;
    /** When true, production startup is permitted with the memory driver and/or no API key. */
    allowInsecure: boolean;
    rateLimitMax: number;
    rateLimitWindowMs: number;
    trustProxy: boolean;
    jsonBodyLimitBytes: number;
  };
  retention: {
    uploadTtlMs: number;
    sweepIntervalMs: number;
  };
  dataset: {
    sampleRows: number;
    maxScanRows: number;
  };
  ai: {
    provider: AiProviderId;
    apiKey: string | null;
    model: string | null;
    baseUrl: string;
    timeoutMs: number;
    maxAttempts: number;
    excludedFields: string[];
    configured: boolean;
  };
  /**
   * End-user authentication (Auth.js): signup/login, sessions, and the identity used to scope data to
   * a tenant. Disabled by default so local development and the existing test suite need no provider.
   */
  auth: {
    enabled: boolean;
    secret: string | null;
    url: string | null;
    trustHost: boolean;
    bootstrapTenantName: string;
    providers: {
      google: { clientId: string; clientSecret: string } | null;
      github: { clientId: string; clientSecret: string } | null;
      email: { apiKey: string; from: string } | null;
    };
  };
  /**
   * Optional folder inbox: drop a day's files into a folder and a saved workflow runs automatically.
   * Each job is a subdirectory holding a primary and an events file.
   */
  inbox: {
    enabled: boolean;
    dir: string;
    configurationId: string | null;
    primaryPattern: string;
    eventsPattern: string;
    pollIntervalMs: number;
    settleMs: number;
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

  const googleConfigured =
    source.AUTH_GOOGLE_ID.trim().length > 0 && source.AUTH_GOOGLE_SECRET.trim().length > 0;
  const githubConfigured =
    source.AUTH_GITHUB_ID.trim().length > 0 && source.AUTH_GITHUB_SECRET.trim().length > 0;
  const emailConfigured =
    source.AUTH_RESEND_KEY.trim().length > 0 && source.AUTH_EMAIL_FROM.trim().length > 0;

  if (source.AUTH_ENABLED) {
    if (source.AUTH_SECRET.trim().length === 0) {
      throw new ConfigurationError('AUTH_SECRET is required when AUTH_ENABLED=true', {
        variable: 'AUTH_SECRET',
      });
    }
    if (!googleConfigured && !githubConfigured && !emailConfigured) {
      throw new ConfigurationError(
        'AUTH_ENABLED=true requires at least one sign-in method: email magic link (AUTH_RESEND_KEY + AUTH_EMAIL_FROM), Google, or GitHub',
        { variable: 'AUTH_RESEND_KEY' },
      );
    }
  }

  if (source.INBOX_ENABLED) {
    if (source.INBOX_DIR.trim().length === 0) {
      throw new ConfigurationError('INBOX_DIR is required when INBOX_ENABLED=true', {
        variable: 'INBOX_DIR',
      });
    }
    if (source.INBOX_CONFIGURATION_ID.trim().length === 0) {
      throw new ConfigurationError(
        'INBOX_CONFIGURATION_ID is required when INBOX_ENABLED=true (the saved workflow to run)',
        { variable: 'INBOX_CONFIGURATION_ID' },
      );
    }
  }

  const corsOrigins = source.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  // Production must be durable and authenticated unless the operator explicitly opts out. These are
  // footguns (silent data loss, an open API), so they are hard failures rather than warnings.
  if (source.NODE_ENV === 'production' && !source.ALLOW_INSECURE) {
    const problems: string[] = [];
    if (source.REPOSITORY_DRIVER !== 'postgres') {
      problems.push('REPOSITORY_DRIVER must be "postgres"');
    }
    if (source.API_KEY.trim().length === 0) {
      problems.push('API_KEY must be set');
    }
    if (source.AUTH_ENABLED && source.AUTH_URL.trim().length === 0) {
      problems.push('AUTH_URL must be set');
    }
    if (problems.length > 0) {
      throw new ConfigurationError(
        `Refusing to start in production: ${problems.join('; ')}. Set ALLOW_INSECURE=true to override for a private pilot.`,
        { variable: 'ALLOW_INSECURE' },
      );
    }
  }

  return {
    nodeEnv: source.NODE_ENV,
    isProduction: source.NODE_ENV === 'production',
    host: source.API_HOST,
    port: source.API_PORT ?? source.PORT ?? 4000,
    logLevel: source.LOG_LEVEL,
    logPretty: source.LOG_PRETTY,
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : ['http://localhost:5173'],
    repository: {
      driver: source.REPOSITORY_DRIVER,
      databaseUrl: source.DATABASE_URL.trim().length > 0 ? source.DATABASE_URL : null,
      autoMigrate: source.DB_AUTO_MIGRATE,
      migrationsDir: source.DB_MIGRATIONS_DIR.trim().length > 0 ? source.DB_MIGRATIONS_DIR : null,
    },
    storage: {
      driver: source.STORAGE_DRIVER,
      localDir: source.STORAGE_LOCAL_DIR,
      maxUploadBytes: Math.round(source.MAX_UPLOAD_MB * 1024 * 1024),
      maxXlsxUncompressedBytes: Math.round(source.MAX_XLSX_UNCOMPRESSED_MB * 1024 * 1024),
      maxXlsxEntries: source.MAX_XLSX_ENTRIES,
    },
    security: {
      apiKey: source.API_KEY.trim().length > 0 ? source.API_KEY : null,
      allowInsecure: source.ALLOW_INSECURE,
      rateLimitMax: source.RATE_LIMIT_MAX,
      rateLimitWindowMs: source.RATE_LIMIT_WINDOW_MS,
      trustProxy: source.TRUST_PROXY,
      jsonBodyLimitBytes: Math.round(source.JSON_BODY_LIMIT_MB * 1024 * 1024),
    },
    retention: {
      uploadTtlMs: Math.round(source.RETENTION_UPLOAD_TTL_HOURS * 60 * 60 * 1000),
      sweepIntervalMs: Math.round(source.RETENTION_SWEEP_INTERVAL_MINUTES * 60 * 1000),
    },
    dataset: {
      sampleRows: source.DATASET_SAMPLE_ROWS,
      maxScanRows: source.DATASET_MAX_SCAN_ROWS,
    },
    ai: {
      provider: source.AI_PROVIDER,
      apiKey: source.OPENAI_API_KEY.trim().length > 0 ? source.OPENAI_API_KEY : null,
      model: source.AI_MODEL.trim().length > 0 ? source.AI_MODEL : null,
      baseUrl:
        source.AI_BASE_URL.trim().length > 0 ? source.AI_BASE_URL : 'https://api.openai.com/v1',
      timeoutMs: source.AI_TIMEOUT_MS,
      maxAttempts: source.AI_MAX_ATTEMPTS,
      excludedFields: source.AI_EXCLUDED_FIELDS.split(',')
        .map((field) => field.trim())
        .filter((field) => field.length > 0),
      configured: source.AI_PROVIDER === 'openai' && source.OPENAI_API_KEY.trim().length > 0,
    },
    auth: {
      enabled: source.AUTH_ENABLED,
      secret: source.AUTH_SECRET.trim().length > 0 ? source.AUTH_SECRET : null,
      url: source.AUTH_URL.trim().length > 0 ? source.AUTH_URL.trim().replace(/\/$/, '') : null,
      trustHost: source.AUTH_TRUST_HOST,
      bootstrapTenantName: source.BOOTSTRAP_TENANT_NAME,
      providers: {
        google: googleConfigured
          ? { clientId: source.AUTH_GOOGLE_ID, clientSecret: source.AUTH_GOOGLE_SECRET }
          : null,
        github: githubConfigured
          ? { clientId: source.AUTH_GITHUB_ID, clientSecret: source.AUTH_GITHUB_SECRET }
          : null,
        email: emailConfigured
          ? { apiKey: source.AUTH_RESEND_KEY, from: source.AUTH_EMAIL_FROM }
          : null,
      },
    },
    inbox: {
      enabled: source.INBOX_ENABLED,
      dir: source.INBOX_DIR.trim(),
      configurationId:
        source.INBOX_CONFIGURATION_ID.trim().length > 0
          ? source.INBOX_CONFIGURATION_ID.trim()
          : null,
      primaryPattern: source.INBOX_PRIMARY_PATTERN,
      eventsPattern: source.INBOX_EVENTS_PATTERN,
      pollIntervalMs: source.INBOX_POLL_INTERVAL_MS,
      settleMs: source.INBOX_SETTLE_MS,
    },
  };
}
