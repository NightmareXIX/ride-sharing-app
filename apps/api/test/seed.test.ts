import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../src/db/client.js';
import { users, vehicles, wallets, walletTransactions } from '../src/db/schema/index.js';
import { DEMO_PASSWORD, seedStoryCast, STORY_VEHICLE } from '../src/db/seeder.js';
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
    expect(await db.$count(wallets)).toBe(4);
    expect(await db.$count(vehicles)).toBe(1);
    expect(await db.$count(walletTransactions)).toBe(3);
  });

  it('tops up the passengers for the demo, through the ledger (FR-S3, NFR-39)', async () => {
    await seedStoryCast(db);
    await seedStoryCast(db);

    const rows = await db
      .select({ name: users.name, balance: wallets.balance })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .orderBy(users.name);
    expect(rows).toEqual([
      { name: 'Jashim', balance: '0.00' },
      { name: 'Nusrat', balance: '500.00' },
      { name: 'Rafiq', balance: '500.00' },
      { name: 'Shirin', balance: '20.00' },
    ]);

    const entries = await db
      .select({
        name: users.name,
        type: walletTransactions.type,
        amount: walletTransactions.amount,
        balanceAfter: walletTransactions.balanceAfter,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
      .innerJoin(users, eq(users.id, wallets.userId))
      .orderBy(users.name);
    expect(entries).toEqual([
      { name: 'Nusrat', type: 'top_up', amount: '500.00', balanceAfter: '500.00' },
      { name: 'Rafiq', type: 'top_up', amount: '500.00', balanceAfter: '500.00' },
      { name: 'Shirin', type: 'top_up', amount: '20.00', balanceAfter: '20.00' },
    ]);
  });

  it("doesn't top up again once the money has been spent", async () => {
    await seedStoryCast(db);
    await db.execute(
      sql`UPDATE ${wallets} SET balance = 0 FROM ${users}
          WHERE ${users.id} = ${wallets.userId} AND ${users.email} = 'shirin@teslapool.test'`,
    );

    await seedStoryCast(db);
    expect(await db.$count(walletTransactions)).toBe(3);
  });

  it("registers Bullet, with 3 seats, as Jashim's Tesla", async () => {
    await seedStoryCast(db);

    const rows = await db
      .select({ driver: users.name, name: vehicles.name, capacity: vehicles.capacity })
      .from(vehicles)
      .innerJoin(users, eq(users.id, vehicles.driverId));
    expect(rows).toEqual([{ driver: 'Jashim', name: 'Bullet', capacity: 3 }]);
  });

  it('parks Bullet offline at Banani Road 11 (FR-S3)', async () => {
    await seedStoryCast(db);

    const [bullet] = await db
      .select({ isOnline: vehicles.isOnline, lat: vehicles.currentLat, lng: vehicles.currentLng })
      .from(vehicles);
    expect(bullet).toEqual({
      isOnline: false,
      lat: STORY_VEHICLE.location.lat,
      lng: STORY_VEHICLE.location.lng,
    });
  });

  it('keeps a location Jashim chose when it runs again', async () => {
    await seedStoryCast(db);
    await db.update(vehicles).set({ currentLat: 23.7806, currentLng: 90.4163 });

    await seedStoryCast(db);
    const [bullet] = await db
      .select({ lat: vehicles.currentLat, lng: vehicles.currentLng })
      .from(vehicles);
    expect(bullet).toEqual({ lat: 23.7806, lng: 90.4163 });
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
