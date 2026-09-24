import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Logger } from '../logger.js';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

// Timestamps are `timestamptz`, so values are stored in UTC and come back as absolute
// instants whatever the session time zone is (NFR-38).
export function createPool(databaseUrl: string, logger?: Logger): pg.Pool {
  // Fail fast rather than queue forever when the database is unreachable.
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client losing its connection must not crash the process.
  pool.on('error', (err) => {
    logger?.error({ err }, 'Idle database client error');
  });
  return pool;
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}
