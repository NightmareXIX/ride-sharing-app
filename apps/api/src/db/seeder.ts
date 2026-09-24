import bcrypt from 'bcryptjs';
import type { Database } from './client.js';
import { users, type NewUser } from './schema/index.js';

// Demo accounts are meant to be public: they are listed in the README (FR-S2).
export const DEMO_PASSWORD = 'TeslaPool#2026';

const BCRYPT_COST = 10;

// The story cast only, no placeholder users (FR-S1). The brief doesn't give genders;
// these are our assumption, chosen so Nusrat and Shirin can demo a same-gender pool.
export const STORY_CAST: ReadonlyArray<Omit<NewUser, 'passwordHash'>> = [
  { name: 'Jashim', email: 'jashim@teslapool.test', gender: 'male', role: 'driver' },
  { name: 'Nusrat', email: 'nusrat@teslapool.test', gender: 'female', role: 'passenger' },
  { name: 'Rafiq', email: 'rafiq@teslapool.test', gender: 'male', role: 'passenger' },
  { name: 'Shirin', email: 'shirin@teslapool.test', gender: 'female', role: 'passenger' },
];

// Safe to run on every start (NFR-31): existing users are left untouched, so restarting
// the API never resets someone's demo progress. Returns the emails actually inserted.
export async function seedStoryCast(db: Database): Promise<string[]> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
  const inserted = await db
    .insert(users)
    .values(STORY_CAST.map((member) => ({ ...member, passwordHash })))
    .onConflictDoNothing({ target: users.email })
    .returning({ email: users.email });
  return inserted.map((row) => row.email);
}
