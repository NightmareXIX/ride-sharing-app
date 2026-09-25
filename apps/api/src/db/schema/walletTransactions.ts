import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { WALLET_TRANSACTION_TYPES } from '../../domain/wallet.js';
import { bookings } from './bookings.js';
import { wallets } from './wallets.js';

export const walletTransactionType = pgEnum('wallet_transaction_type', WALLET_TRANSACTION_TYPES);

function money(name: string) {
  return numeric(name, { precision: 10, scale: 2 });
}

// Every money movement, kept forever (FR-W8, NFR-39): a trigger in the migration refuses
// UPDATE and DELETE, so a mistake is fixed by adding a correcting entry. Apart from cash
// earnings, a wallet's balance is the sum of its entries.
export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    // For a top-up, chosen by the client, so a repeated submit is recognised (NFR-37).
    id: uuid('id').primaryKey().defaultRandom(),
    // Insertion order: the history is sorted and paged by it.
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull().unique(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    bookingId: uuid('booking_id').references(() => bookings.id),
    type: walletTransactionType('type').notNull(),
    // Signed: money in is positive, money out negative.
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('wallet_transactions_wallet_seq_idx').on(t.walletId, t.seq),
    // A ride is paid, credited, earned and fined at most once.
    uniqueIndex('wallet_transactions_one_per_booking_type')
      .on(t.bookingId, t.type)
      .where(sql`${t.bookingId} IS NOT NULL`),
    check(
      'wallet_transactions_amount_sign',
      sql`CASE WHEN ${t.type} IN ('fare_payment', 'fine') THEN ${t.amount} < 0 ELSE ${t.amount} > 0 END`,
    ),
    // Only a top-up stands apart from a ride.
    check('wallet_transactions_booking', sql`(${t.type} = 'top_up') = (${t.bookingId} IS NULL)`),
  ],
);

export type WalletTransaction = typeof walletTransactions.$inferSelect;
