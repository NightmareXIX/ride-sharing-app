import { loadDatabaseConfig } from '../config.js';
import { createDb, createPool } from './client.js';
import { seedStoryCast } from './seeder.js';

// CLI: `npm run db:seed`, and the second step of the API container's start command.
const config = loadDatabaseConfig();
const pool = createPool(config.DATABASE_URL);
try {
  const inserted = await seedStoryCast(createDb(pool));
  console.log(inserted.length > 0 ? `Seeded: ${inserted.join(', ')}` : 'Seed data already present');
} catch (err) {
  console.error('Seeding failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
