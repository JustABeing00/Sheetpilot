import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Logger } from '@sheetpilot/core';
import type { Database } from './client.js';

const defaultMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(
  db: Database,
  options: { migrationsFolder?: string; logger?: Logger } = {},
): Promise<void> {
  const folder = options.migrationsFolder ?? defaultMigrationsFolder;
  options.logger?.info(
    { folder: path.relative(process.cwd(), folder) },
    'applying database migrations',
  );
  await migrate(db, { migrationsFolder: folder });
}
