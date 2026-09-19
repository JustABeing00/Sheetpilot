import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema/tables.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  /** Cheap connectivity probe for readiness checks. Throws when the server is unreachable. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });

  return {
    db,
    async ping() {
      await client`select 1`;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
