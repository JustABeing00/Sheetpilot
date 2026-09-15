import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/tables.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://sheetpilot:sheetpilot@localhost:5432/sheetpilot',
  },
});
