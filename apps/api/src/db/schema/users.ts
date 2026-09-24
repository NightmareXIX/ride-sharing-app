import { sql } from 'drizzle-orm';
import { check, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['passenger', 'driver']);

// Required at sign-up (FR-P1) because the same-gender pool depends on it (FR-R10).
export const gender = pgEnum('gender', ['female', 'male']);

// One table for both roles (Core Entities §3).
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    gender: gender('gender').notNull(),
    role: userRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Emails are stored lowercased so the unique constraint is case-insensitive.
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
