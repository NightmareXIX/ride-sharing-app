import { and, eq, inArray, isNull } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';
import { postEntry } from '../services/wallet.js';
import type { Database } from './client.js';
import { users, vehicles, wallets, walletTransactions, type NewUser } from './schema/index.js';

// Demo accounts are meant to be public: they are listed in the README (FR-S2).
export const DEMO_PASSWORD = 'TeslaPool#2026';

// The story cast only, no placeholder users (FR-S1). The brief doesn't give genders;
// these are our assumption, chosen so Nusrat and Shirin can demo a same-gender pool.
export const STORY_CAST: ReadonlyArray<Omit<NewUser, 'passwordHash'>> = [
  { name: 'Jashim', email: 'jashim@teslapool.test', gender: 'male', role: 'driver' },
  { name: 'Nusrat', email: 'nusrat@teslapool.test', gender: 'female', role: 'passenger' },
  { name: 'Rafiq', email: 'rafiq@teslapool.test', gender: 'male', role: 'passenger' },
  { name: 'Shirin', email: 'shirin@teslapool.test', gender: 'female', role: 'passenger' },
];

// Jashim's Tesla from the brief. It starts offline at Banani Road 11, where the story
// begins, so Jashim can go online straight away in the demo.
export const STORY_VEHICLE = {
  driverEmail: 'jashim@teslapool.test',
  name: 'Bullet',
  capacity: 3,
  location: { lat: 23.7937, lng: 90.4066 },
};

// Demo money, so the story can be shown (FR-S3): Nusrat and Rafiq pay their pooled ride by
// TeslaPay, and Shirin's 20 tk is small enough that a 30 tk fine takes her below zero,
// which shows the negative-balance block. Jashim earns from rides. Each top-up has a fixed
// id, so it is made once however often the seed runs.
export const STORY_TOP_UPS = [
  { id: '5eed0000-0000-4000-8000-000000000001', email: 'nusrat@teslapool.test', amount: '500.00' },
  { id: '5eed0000-0000-4000-8000-000000000002', email: 'rafiq@teslapool.test', amount: '500.00' },
  { id: '5eed0000-0000-4000-8000-000000000003', email: 'shirin@teslapool.test', amount: '20.00' },
] as const;

// Safe to run on every start (NFR-31): existing rows are left untouched, so restarting
// the API never resets someone's demo progress. Returns the emails actually inserted.
export async function seedStoryCast(db: Database): Promise<string[]> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values(STORY_CAST.map((member) => ({ ...member, passwordHash })))
      .onConflictDoNothing({ target: users.email })
      .returning({ email: users.email });

    const cast = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        inArray(
          users.email,
          STORY_CAST.map((member) => member.email),
        ),
      );

    await tx
      .insert(wallets)
      .values(cast.map((member) => ({ userId: member.id })))
      .onConflictDoNothing({ target: wallets.userId });

    // Money only moves through the ledger (NFR-39), so the demo balances are top-ups too.
    for (const topUp of STORY_TOP_UPS) {
      const [member] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, topUp.email));
      if (!member) continue;
      // Locked first, so two seeds running at once can't both make the top-up.
      await tx
        .select({ id: wallets.id })
        .from(wallets)
        .where(eq(wallets.userId, member.id))
        .for('update');
      const [made] = await tx
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .where(eq(walletTransactions.id, topUp.id));
      if (made) continue;
      await postEntry(tx, {
        id: topUp.id,
        userId: member.id,
        type: 'top_up',
        amount: topUp.amount,
      });
    }

    const [driver] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, STORY_VEHICLE.driverEmail));
    if (driver) {
      await tx
        .insert(vehicles)
        .values({ driverId: driver.id, name: STORY_VEHICLE.name, capacity: STORY_VEHICLE.capacity })
        .onConflictDoNothing({ target: vehicles.driverId });

      // Only a Tesla with no location yet, so a location Jashim chose survives restarts.
      await tx
        .update(vehicles)
        .set({ currentLat: STORY_VEHICLE.location.lat, currentLng: STORY_VEHICLE.location.lng })
        .where(and(eq(vehicles.driverId, driver.id), isNull(vehicles.currentLat)));
    }

    return inserted.map((row) => row.email);
  });
}
