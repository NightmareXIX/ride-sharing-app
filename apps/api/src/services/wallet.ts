import Big from 'big.js';
import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { bookingStatusHistory, wallets, walletTransactions } from '../db/schema/index.js';
import type { TransitionReason } from '../domain/booking.js';
import {
  affectsBalance,
  MAX_BALANCE,
  signedAmount,
  type WalletTransactionType,
} from '../domain/wallet.js';
import { AppError } from '../http/errors.js';
import { toPage, type Page, type PageRequest } from '../http/pagination.js';

// A user's TeslaPay wallet as they see it (FR-W1).
export interface WalletView {
  // Money travels as a string such as "447.98", never a float.
  balance: string;
  updatedAt: Date;
}

// Why a passenger was fined.
export type FineReason = Extract<TransitionReason, 'late_cancel' | 'no_show'>;

// One entry of the wallet's history (FR-W8).
export interface TransactionView {
  id: string;
  type: WalletTransactionType;
  // Signed: "-30.00" is money out.
  amount: string;
  balanceAfter: string;
  bookingId: string | null;
  // For a fine, why it was charged; null for every other movement.
  reason: FineReason | null;
  createdAt: Date;
}

export interface EntryRequest {
  userId: string;
  type: WalletTransactionType;
  // The size of the movement; the type decides its sign.
  amount: string;
  bookingId?: string;
  // A top-up's id is chosen by the client, so a repeated submit is recognised (NFR-37).
  id?: string;
}

// Records one money movement and applies it to the wallet, inside the caller's transaction,
// which also locks the wallet row until it ends. This is the only code that changes a
// balance, so the balance always equals the sum of the ledger (NFR-39).
export async function postEntry(tx: Transaction, entry: EntryRequest): Promise<TransactionView> {
  const { userId, type, bookingId } = entry;
  const amount = signedAmount(type, entry.amount);

  let wallet: { id: string; balance: string } | undefined;
  if (affectsBalance(type)) {
    // A fare payment never takes a balance below zero: only a fine can (FR-W6). The
    // balance covered the estimate when the ride was requested, so this always holds.
    const covered: SQL =
      type === 'fare_payment' ? sql`${wallets.balance} + ${amount} >= 0` : sql`true`;
    [wallet] = await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${amount}`, updatedAt: sql`now()` })
      .where(and(eq(wallets.userId, userId), covered))
      .returning({ id: wallets.id, balance: wallets.balance });
  } else {
    // A cash fare is paid in person: recorded, but the balance stays as it is (FR-W5).
    [wallet] = await tx
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .for('update');
  }
  if (!wallet) throw new Error(`Wallet of user ${userId} can't take a ${type} of ${amount}`);

  const [row] = await tx
    .insert(walletTransactions)
    .values({
      ...(entry.id !== undefined && { id: entry.id }),
      walletId: wallet.id,
      bookingId: bookingId ?? null,
      type,
      amount,
      balanceAfter: wallet.balance,
    })
    .returning(entryColumns);
  if (!row) throw new Error('Inserting the wallet entry returned no row');
  return toTransactionView({ ...row, reason: null });
}

const entryColumns = {
  id: walletTransactions.id,
  seq: walletTransactions.seq,
  walletId: walletTransactions.walletId,
  type: walletTransactions.type,
  amount: walletTransactions.amount,
  balanceAfter: walletTransactions.balanceAfter,
  bookingId: walletTransactions.bookingId,
  createdAt: walletTransactions.createdAt,
};

// Why the fined booking was cancelled, from its history: late_cancel or no_show.
const fineReason = sql<FineReason | null>`CASE WHEN ${walletTransactions.type} = 'fine' THEN (
  SELECT ${bookingStatusHistory.reason} FROM ${bookingStatusHistory}
  WHERE ${bookingStatusHistory.bookingId} = ${walletTransactions.bookingId}
    AND ${bookingStatusHistory.toStatus} = 'CANCELLED'
  ORDER BY ${bookingStatusHistory.createdAt} DESC, ${bookingStatusHistory.id} DESC
  LIMIT 1
) END`;

type EntryRow = typeof walletTransactions.$inferSelect & { reason: FineReason | null };

function toTransactionView(row: Omit<EntryRow, 'seq' | 'walletId'>): TransactionView {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    bookingId: row.bookingId,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export async function getWallet(db: Database | Transaction, userId: string): Promise<WalletView> {
  const [wallet] = await db
    .select({ balance: wallets.balance, updatedAt: wallets.updatedAt })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  if (!wallet) throw new Error(`User ${userId} has no wallet`);
  return wallet;
}

// The user's own money movements, newest first, a page at a time (FR-W8, NFR-36).
export async function listTransactions(
  db: Database,
  userId: string,
  { after, limit }: PageRequest,
): Promise<Page<TransactionView>> {
  const rows = await db
    .select({ ...entryColumns, reason: fineReason })
    .from(walletTransactions)
    .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
    .where(
      and(
        eq(wallets.userId, userId),
        after === null ? undefined : lt(walletTransactions.seq, after),
      ),
    )
    .orderBy(desc(walletTransactions.seq))
    .limit(limit + 1);
  const page = toPage(rows, limit, (row) => row.seq);
  return { ...page, items: page.items.map(toTransactionView) };
}

export interface TopUpRequest {
  // Made by the client when the form opens, and sent again on a retry.
  id: string;
  amount: string;
}

export interface TopUpResult {
  transaction: TransactionView;
  wallet: WalletView;
  // False when the top-up repeated one that was already made.
  created: boolean;
}

function reusedId(): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'Some fields are missing or invalid.', [
    { path: 'id', message: 'This top-up was already made with different details.' },
  ]);
}

// Adds pretend money to a passenger's wallet (FR-W2). The wallet is locked first, so a
// second tap of the same top-up waits for the first and then finds its entry (NFR-37).
export async function topUp(
  db: Database,
  passengerId: string,
  request: TopUpRequest,
): Promise<TopUpResult> {
  try {
    return await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select({ id: wallets.id, balance: wallets.balance })
        .from(wallets)
        .where(eq(wallets.userId, passengerId))
        .for('update');
      if (!wallet) throw new Error(`User ${passengerId} has no wallet`);

      const [earlier] = await tx
        .select(entryColumns)
        .from(walletTransactions)
        .where(eq(walletTransactions.id, request.id));
      if (earlier) {
        const repeat =
          earlier.walletId === wallet.id &&
          earlier.type === 'top_up' &&
          new Big(earlier.amount).eq(request.amount);
        if (!repeat) throw reusedId();
        return {
          transaction: toTransactionView({ ...earlier, reason: null }),
          wallet: await getWallet(tx, passengerId),
          created: false,
        };
      }

      if (new Big(wallet.balance).plus(request.amount).gt(MAX_BALANCE)) {
        throw new AppError(
          422,
          'BALANCE_LIMIT',
          `Your balance can't go above ৳ ${new Big(MAX_BALANCE).toFixed(2)}.`,
        );
      }
      const transaction = await postEntry(tx, {
        id: request.id,
        userId: passengerId,
        type: 'top_up',
        amount: request.amount,
      });
      return { transaction, wallet: await getWallet(tx, passengerId), created: true };
    });
  } catch (err) {
    // The id belongs to another user's entry. The primary key decides, not the lookup.
    if (isUniqueViolation(err, 'wallet_transactions_pkey')) throw reusedId();
    throw err;
  }
}
