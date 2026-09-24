import { defineConfig } from 'drizzle-kit';

// Used only by drizzle-kit to generate SQL migrations from the schema; the app applies
// them at runtime with drizzle-orm's migrator (src/db/migrate.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://tesla:tesla@localhost:5432/tesla_pool',
  },
  strict: true,
});
