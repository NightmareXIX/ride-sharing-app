import { loadConfig } from '../config.js';
import { createDb, createPool } from './client.js';
import { runMigrations } from './migrator.js';

// CLI: `npm run db:migrate`, and the first step of the API container's start command.
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
try {
  await runMigrations(createDb(pool));
  console.log('Migrations applied');
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
