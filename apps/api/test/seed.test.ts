import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../src/db/client.js';
import { users } from '../src/db/schema/index.js';
import { DEMO_PASSWORD, seedStoryCast } from '../src/db/seeder.js';
import { TEST_DATABASE_URL } from './support/db.js';

let pool: pg.Pool;
let db: Database;

beforeAll(() => {
  pool = createPool(TEST_DATABASE_URL);
  db = createDb(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${users} CASCADE`);
});

describe('story cast seed (FR-S1, NFR-31)', () => {
  it('creates Jashim as the driver and Nusrat, Rafiq and Shirin as passengers', async () => {
    await seedStoryCast(db);

    const rows = await db
      .select({ name: users.name, role: users.role, gender: users.gender })
      .from(users)
      .orderBy(users.name);
    expect(rows).toEqual([
      { name: 'Jashim', role: 'driver', gender: 'male' },
      { name: 'Nusrat', role: 'passenger', gender: 'female' },
      { name: 'Rafiq', role: 'passenger', gender: 'male' },
      { name: 'Shirin', role: 'passenger', gender: 'female' },
    ]);
  });

  it('is safe to run more than once', async () => {
    const first = await seedStoryCast(db);
    const second = await seedStoryCast(db);

    expect(first).toHaveLength(4);
    expect(second).toEqual([]);
    expect(await db.$count(users)).toBe(4);
  });

  it('stores a bcrypt hash of the demo password, never the password itself', async () => {
    await seedStoryCast(db);

    const [nusrat] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, 'nusrat@teslapool.test'));
    expect(nusrat?.passwordHash).not.toContain(DEMO_PASSWORD);
    expect(await bcrypt.compare(DEMO_PASSWORD, nusrat!.passwordHash)).toBe(true);
  });
});
