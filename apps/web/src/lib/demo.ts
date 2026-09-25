import type { Role } from './account';

// The seeded story cast (FR-S1), whose credentials are public in the README (FR-S2).
// Mirrors STORY_CAST in apps/api/src/db/seeder.ts; keep the two in step.
export const DEMO_PASSWORD = 'TeslaPool#2026';

export interface DemoAccount {
  name: string;
  email: string;
  role: Role;
  blurb: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    name: 'Jashim',
    email: 'jashim@teslapool.test',
    role: 'driver',
    blurb: 'Drives Bullet (3 seats). Go online and accept nearby requests.',
  },
  {
    name: 'Nusrat',
    email: 'nusrat@teslapool.test',
    role: 'passenger',
    blurb: 'Banani → Mohakhali with ৳ 500 in TeslaPay. Pools with Rafiq.',
  },
  {
    name: 'Rafiq',
    email: 'rafiq@teslapool.test',
    role: 'passenger',
    blurb: "Banani → Gulshan 1 with ৳ 500 in TeslaPay. Joins Nusrat's pool.",
  },
  {
    name: 'Shirin',
    email: 'shirin@teslapool.test',
    role: 'passenger',
    blurb: 'Only ৳ 20 in TeslaPay: try a same-gender pool, or a late cancel that ends in a fine.',
  },
];
