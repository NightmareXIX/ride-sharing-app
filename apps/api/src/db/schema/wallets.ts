import { numeric, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Every user's TeslaPay wallet (FR-W1), created in the same transaction as the user.
// numeric comes back from pg as a string, so balances never pass through a float.
export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  balance: numeric('balance', { precision: 10, scale: 2 }).notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Wallet = typeof wallets.$inferSelect;
