import { and, eq, inArray, isNull } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';
import type { Database } from './client.js';
import { users, vehicles, wallets, type NewUser } from './schema/index.js';

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

    // Balances start at zero: money only moves through the ledger (NFR-39).
    await tx
      .insert(wallets)
      .values(cast.map((member) => ({ userId: member.id })))
      .onConflictDoNothing({ target: wallets.userId });

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
