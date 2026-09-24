import pg from 'pg';
import { createDb, createPool } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';
import { TEST_DATABASE_URL } from './support/db.js';

// Creates the test database on first use, then brings its schema up to date.
async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      dbName,
    ]);
    if (rowCount === 0) {
      // Identifiers can't be bound as parameters; the name comes from our own config.
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<void> {
  await ensureDatabaseExists(TEST_DATABASE_URL);
  const pool = createPool(TEST_DATABASE_URL);
  try {
    await runMigrations(createDb(pool));
  } finally {
    await pool.end();
  }
}
