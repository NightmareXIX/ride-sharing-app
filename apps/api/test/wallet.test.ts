import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import { driverSignUp, getJson, passengerSignUp, resetDb, signUpAs } from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import { errorCode } from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';
import {
  allTransactions,
  balanceOf,
  expectLedgerConsistent,
  postTopUp,
  topUp,
  type TransactionBody,
} from './support/wallet.js';

let pool: pg.Pool;
let server: TestServer;
let nusrat: string;
let rafiq: string;
let jashim: string;

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL);
  server = await startTestServer(pool);
});

afterAll(async () => {
  await server.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  jashim = await signUpAs(server, driverSignUp());
  nusrat = await signUpAs(server, passengerSignUp());
  rafiq = await signUpAs(server, passengerSignUp({ name: 'Rafiq', email: 'rafiq@example.com' }));
});

async function validationPaths(res: Response): Promise<string[]> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as {
    error: { code: string; details: Array<{ path: string }> };
  };
  expect(body.error.code).toBe('VALIDATION_ERROR');
  return body.error.details.map((detail) => detail.path);
}

describe('GET /api/v1/wallet', () => {
  it('shows the balance of a new wallet', async () => {
    const res = await getJson(server, '/api/v1/wallet', jashim);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wallet: { balance: string; updatedAt: string } };
    expect(body.wallet.balance).toBe('0.00');
    expect(Date.parse(body.wallet.updatedAt)).not.toBeNaN();
  });

  it('needs a signed-in user', async () => {
    const res = await getJson(server, '/api/v1/wallet');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/wallet/top-ups (FR-W2)', () => {
  it('adds the amount and records a top-up', async () => {
    const id = randomUUID();
    const res = await postTopUp(server, nusrat, '500.00', id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      transaction: TransactionBody;
      wallet: { balance: string };
    };
    expect(body.wallet.balance).toBe('500.00');
    expect(body.transaction).toMatchObject({
      id,
      type: 'top_up',
      amount: '500.00',
      balanceAfter: '500.00',
      bookingId: null,
      reason: null,
    });
    expect(await topUp(server, nusrat, '12.5')).toBe('512.50');
    await expectLedgerConsistent(pool);
  });

  it('answers a repeated submit with the same top-up, once (NFR-37)', async () => {
    const id = randomUUID();
    const first = await postTopUp(server, nusrat, '100.00', id);
    expect(first.status).toBe(201);
    const again = await postTopUp(server, nusrat, '100', id);
    expect(again.status).toBe(200);
    const body = (await again.json()) as { transaction: TransactionBody };
    expect(body.transaction.id).toBe(id);
    expect(await balanceOf(server, nusrat)).toBe('100.00');
    expect(await allTransactions(server, nusrat)).toHaveLength(1);
  });

  it('refuses an id already used with other details', async () => {
    const id = randomUUID();
    expect((await postTopUp(server, nusrat, '100.00', id)).status).toBe(201);
    expect(await validationPaths(await postTopUp(server, nusrat, '200.00', id))).toEqual(['id']);
    // Another passenger can't reuse it either, and learns nothing about it.
    expect(await validationPaths(await postTopUp(server, rafiq, '100.00', id))).toEqual(['id']);
    expect(await balanceOf(server, rafiq)).toBe('0.00');
  });

  it.each([['0.99'], ['10000.01'], ['5.001'], ['-5.00'], ['abc'], [''], [500]])(
    'refuses the amount %j',
    async (amount) => {
      const res = await postTopUp(server, nusrat, amount as string);
      expect(await validationPaths(res)).toEqual(['amount']);
      expect(await balanceOf(server, nusrat)).toBe('0.00');
    },
  );

  it('accepts the limits of a single top-up', async () => {
    expect(await topUp(server, nusrat, '1.00')).toBe('1.00');
    expect(await topUp(server, nusrat, '10000.00')).toBe('10001.00');
  });

  it('refuses an id that is not a UUID', async () => {
    const res = await postTopUp(server, nusrat, '10.00', 'not-a-uuid');
    expect(await validationPaths(res)).toEqual(['id']);
  });

  it('keeps the balance at most ৳ 100,000.00', async () => {
    for (let i = 0; i < 10; i += 1) await topUp(server, nusrat, '10000.00');
    const res = await postTopUp(server, nusrat, '1.00');
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('BALANCE_LIMIT');
    expect(await balanceOf(server, nusrat)).toBe('100000.00');
  });

  it('is for passengers only', async () => {
    const res = await postTopUp(server, jashim, '100.00');
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('WRONG_ROLE');
    expect(await balanceOf(server, jashim)).toBe('0.00');
  });
});

describe('GET /api/v1/wallet/transactions (FR-W8, NFR-36)', () => {
  it('pages through the history, newest first, with no gaps or repeats', async () => {
    for (let i = 1; i <= 25; i += 1) await topUp(server, nusrat, `${i}.00`);

    const pages: TransactionBody[][] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?limit=10&cursor=${cursor}` : '?limit=10';
      const res = await getJson(server, `/api/v1/wallet/transactions${query}`, nusrat);
      expect(res.status).toBe(200);
      const page = (await res.json()) as {
        transactions: TransactionBody[];
        nextCursor: string | null;
      };
      pages.push(page.transactions);
      cursor = page.nextCursor;
    } while (cursor);

    expect(pages.map((page) => page.length)).toEqual([10, 10, 5]);
    const amounts = pages.flat().map((entry) => entry.amount);
    expect(amounts).toEqual(Array.from({ length: 25 }, (_, i) => `${25 - i}.00`));
    expect(new Set(pages.flat().map((entry) => entry.id)).size).toBe(25);
  });

  it('uses 20 entries a page by default', async () => {
    for (let i = 0; i < 21; i += 1) await topUp(server, nusrat, '1.00');
    const res = await getJson(server, '/api/v1/wallet/transactions', nusrat);
    const page = (await res.json()) as { transactions: unknown[]; nextCursor: string | null };
    expect(page.transactions).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
  });

  it('shows only the user’s own entries', async () => {
    await topUp(server, nusrat, '50.00');
    await topUp(server, rafiq, '70.00');
    expect((await allTransactions(server, rafiq)).map((entry) => entry.amount)).toEqual(['70.00']);
    expect(await allTransactions(server, jashim)).toEqual([]);
  });

  it.each([['?cursor=%%%'], ['?cursor=bm9wZQ'], ['?limit=0'], ['?limit=51'], ['?limit=two']])(
    'refuses the query %s',
    async (query) => {
      const res = await getJson(server, `/api/v1/wallet/transactions${query}`, nusrat);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('VALIDATION_ERROR');
    },
  );
});

describe('the ledger is append-only (NFR-39)', () => {
  it('refuses to edit or delete an entry', async () => {
    await topUp(server, nusrat, '100.00');
    await expect(pool.query("UPDATE wallet_transactions SET amount = '1.00'")).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query('DELETE FROM wallet_transactions')).rejects.toThrow(/append-only/);
    expect(await balanceOf(server, nusrat)).toBe('100.00');
  });

  it('refuses an entry whose sign doesn’t match its type', async () => {
    await topUp(server, nusrat, '100.00');
    await expect(
      pool.query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after)
         SELECT wallet_id, 'top_up', '-5.00', '95.00' FROM wallet_transactions`,
      ),
    ).rejects.toThrow(/wallet_transactions_amount_sign/);
  });
});
