import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect } from 'vitest';
import { getJson, postJson } from './accounts.js';
import { BANANI, acceptRequest, ageAcceptance, requestRide, tripFrom } from './rides.js';
import type { TestServer } from './server.js';

export interface TransactionBody {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  bookingId: string | null;
  reason: string | null;
  createdAt: string;
}

export function postTopUp(
  server: TestServer,
  passenger: string,
  amount: string,
  id: string = randomUUID(),
): Promise<Response> {
  return postJson(server, '/api/v1/wallet/top-ups', { id, amount }, passenger);
}

// Tops the passenger up through the API, so the ledger records it; returns the new balance.
export async function topUp(server: TestServer, passenger: string, amount: string) {
  const res = await postTopUp(server, passenger, amount);
  if (res.status !== 201) throw new Error(`Top-up failed with ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { wallet: { balance: string } }).wallet.balance;
}

export async function balanceOf(server: TestServer, user: string): Promise<string> {
  const res = await getJson(server, '/api/v1/wallet', user);
  if (res.status !== 200) throw new Error(`Reading the wallet failed with ${res.status}`);
  return ((await res.json()) as { wallet: { balance: string } }).wallet.balance;
}

// Every entry of the user's wallet, newest first, read page by page.
export async function allTransactions(
  server: TestServer,
  user: string,
  limit = 50,
): Promise<TransactionBody[]> {
  const entries: TransactionBody[] = [];
  let cursor: string | null = null;
  do {
    const query: string = `?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
    const res = await getJson(server, `/api/v1/wallet/transactions${query}`, user);
    if (res.status !== 200) throw new Error(`Reading the history failed with ${res.status}`);
    const page = (await res.json()) as {
      transactions: TransactionBody[];
      nextCursor: string | null;
    };
    entries.push(...page.transactions);
    cursor = page.nextCursor;
  } while (cursor);
  return entries;
}

// The ledger entries of one booking, as the database holds them.
export async function entriesFor(
  pool: pg.Pool,
  bookingId: string,
): Promise<Array<{ type: string; amount: string; email: string }>> {
  const { rows } = await pool.query<{ type: string; amount: string; email: string }>(
    `SELECT t.type, t.amount, u.email FROM wallet_transactions t
     JOIN wallets w ON w.id = t.wallet_id JOIN users u ON u.id = w.user_id
     WHERE t.booking_id = $1 ORDER BY t.seq`,
    [bookingId],
  );
  return rows;
}

// The ledger invariant (phase 6 LLD §4): every balance is the sum of its wallet's entries,
// cash earnings aside, and each entry's balance_after follows from the one before it.
export async function expectLedgerConsistent(pool: pg.Pool): Promise<void> {
  const { rows: sums } = await pool.query(
    `SELECT w.id, w.balance,
       coalesce(sum(t.amount) FILTER (WHERE t.type <> 'cash_earning'), 0) AS ledger
     FROM wallets w LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
     GROUP BY w.id, w.balance
     HAVING w.balance <> coalesce(sum(t.amount) FILTER (WHERE t.type <> 'cash_earning'), 0)`,
  );
  expect(sums, 'wallets whose balance differs from their ledger').toEqual([]);

  const { rows: chain } = await pool.query(
    `SELECT id FROM (
       SELECT t.id, t.balance_after,
         sum(CASE WHEN t.type = 'cash_earning' THEN 0 ELSE t.amount END)
           OVER (PARTITION BY t.wallet_id ORDER BY t.seq) AS running
       FROM wallet_transactions t
     ) entries WHERE balance_after <> running`,
  );
  expect(chain, 'entries whose balance_after breaks the running total').toEqual([]);
}

// Fines the passenger 30 tk the way the app does: a ride accepted by the driver, cancelled
// by the passenger more than 3 minutes later (FR-P7). The driver must be online nearby.
export async function fineByLateCancel(
  server: TestServer,
  pool: pg.Pool,
  driver: string,
  passenger: string,
): Promise<void> {
  const booking = await requestRide(server, passenger, tripFrom(BANANI));
  const accepted = await acceptRequest(server, driver, booking.id);
  if (accepted.status !== 200) throw new Error(`Accept failed with ${accepted.status}`);
  await ageAcceptance(pool, booking.id, '3 minutes 1 second');
  const cancelled = await postJson(server, `/api/v1/bookings/${booking.id}/cancel`, {}, passenger);
  if (cancelled.status !== 200) throw new Error(`Cancel failed with ${cancelled.status}`);
}
