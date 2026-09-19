import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '@sheetpilot/core';
import { loadConfig } from './schema.js';

describe('loadConfig', () => {
  it('returns safe defaults for an empty environment', () => {
    const config = loadConfig({});

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(4000);
    expect(config.repository.driver).toBe('memory');
    expect(config.repository.databaseUrl).toBeNull();
    expect(config.storage.localDir).toBe('.data/storage');
    expect(config.storage.maxUploadBytes).toBe(50 * 1024 * 1024);
    expect(config.ai.provider).toBe('noop');
    expect(config.ai.configured).toBe(false);
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('coerces numbers and splits cors origins', () => {
    const config = loadConfig({
      API_PORT: '8080',
      MAX_UPLOAD_MB: '12.5',
      CORS_ORIGIN: 'http://a.test, http://b.test',
    });

    expect(config.port).toBe(8080);
    expect(config.storage.maxUploadBytes).toBe(Math.round(12.5 * 1024 * 1024));
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('requires DATABASE_URL for the postgres driver', () => {
    expect(() => loadConfig({ REPOSITORY_DRIVER: 'postgres' })).toThrow(ConfigurationError);
  });

  it('accepts a postgres connection string', () => {
    const config = loadConfig({
      REPOSITORY_DRIVER: 'postgres',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/sheetpilot',
    });

    expect(config.repository.driver).toBe('postgres');
    expect(config.repository.databaseUrl).toContain('postgres://');
  });

  it('requires an API key for openai', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'openai' })).toThrow(ConfigurationError);

    const config = loadConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' });
    expect(config.ai.configured).toBe(true);
    expect(config.ai.apiKey).toBe('test-key');
  });

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ API_PORT: 'not-a-port' })).toThrow(ConfigurationError);
  });

  it('falls back to the platform PORT when API_PORT is absent, and API_PORT wins', () => {
    expect(loadConfig({ PORT: '10000' }).port).toBe(10000);
    expect(loadConfig({ API_PORT: '4000', PORT: '10000' }).port).toBe(4000);
  });

  it('refuses an insecure production configuration unless ALLOW_INSECURE is set', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigurationError);

    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        REPOSITORY_DRIVER: 'postgres',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/sheetpilot',
        API_KEY: 'shared-secret',
      }),
    ).not.toThrow();

    expect(() => loadConfig({ NODE_ENV: 'production', ALLOW_INSECURE: 'true' })).not.toThrow();
  });
});
