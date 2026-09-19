import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Logger } from '@sheetpilot/core';
import type { Database } from './client.js';

const defaultMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Resolves the Drizzle SQL folder. Explicit `migrationsFolder` wins, then `DB_MIGRATIONS_DIR`, then the
 * path relative to this module (correct when running from source or the package build). The bundled API
 * has no `../drizzle`, so a production deployment sets `DB_MIGRATIONS_DIR`.
 */
export function resolveMigrationsFolder(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return path.resolve(explicit);
  }
  const fromEnv = process.env['DB_MIGRATIONS_DIR'];
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }
  return defaultMigrationsFolder;
}

export async function runMigrations(
  db: Database,
  options: { migrationsFolder?: string; logger?: Logger } = {},
): Promise<void> {
  const folder = resolveMigrationsFolder(options.migrationsFolder);
  options.logger?.info(
    { folder: path.relative(process.cwd(), folder) },
    'applying database migrations',
  );
  await migrate(db, { migrationsFolder: folder });
}
