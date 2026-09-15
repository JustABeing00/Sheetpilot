import { createDatabase } from '../client.js';
import { runMigrations } from '../migrations.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const handle = createDatabase(connectionString);
  try {
    await runMigrations(handle.db, {
      logger: {
        trace: () => undefined,
        debug: () => undefined,
        info: (fields, message) => console.warn(message, fields),
        warn: (fields, message) => console.warn(message, fields),
        error: (fields, message) => console.error(message, fields),
        child: () => {
          throw new Error('child logger is not supported in the migration script');
        },
      },
    });
    console.warn('Migrations applied successfully');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed', error);
  process.exitCode = 1;
});
