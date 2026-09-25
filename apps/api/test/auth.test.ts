import bcrypt from 'bcryptjs';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import {
  driverSignUp,
  passengerSignUp,
  PASSWORD,
  postJson,
  resetDb,
  sessionSetCookie,
} from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import { startTestServer, type TestServer } from './support/server.js';

let pool: pg.Pool;
let server: TestServer;

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
});

function signUp(body: unknown) {
  return postJson(server, '/api/v1/auth/signup', body);
}

function logIn(email: string, password: string) {
  return postJson(server, '/api/v1/auth/login', { email, password });
}

async function validationPaths(res: Response): Promise<string[]> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as {
    error: { code: string; details: Array<{ path: string }> };
  };
  expect(body.error.code).toBe('VALIDATION_ERROR');
  return body.error.details.map((detail) => detail.path);
}

describe('sign-up (FR-P1, FR-D1, FR-W1)', () => {
  it('creates a passenger with an empty wallet and signs them in', async () => {
    const res = await signUp(passengerSignUp({ email: '  Nusrat@Example.COM ' }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      user: {
        id: expect.any(String),
        name: 'Nusrat',
        email: 'nusrat@example.com',
        gender: 'female',
        role: 'passenger',
        createdAt: expect.any(String),
      },
      wallet: { balance: '0.00' },
      vehicle: null,
      currentBooking: null,
    });
  });

  it('sets a 24-hour HttpOnly session cookie (NFR-6)', async () => {
    const cookie = sessionSetCookie(await signUp(passengerSignUp()));

    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60,
    });
    expect(cookie?.value).toBeTruthy();
  });

  it('stores a bcrypt hash, never the password (NFR-7)', async () => {
    await signUp(passengerSignUp());

    const { rows } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      ['nusrat@example.com'],
    );
    expect(rows[0]?.password_hash).not.toContain(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, rows[0]!.password_hash)).toBe(true);
  });

  it("registers a driver's Tesla with the account", async () => {
    const res = await signUp(driverSignUp());

    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { role: string }; vehicle: unknown };
    expect(body.user.role).toBe('driver');
    expect(body.vehicle).toEqual({ id: expect.any(String), name: 'Bullet', capacity: 3 });
  });

  it('refuses a driver without a Tesla', async () => {
    expect(await validationPaths(await signUp(driverSignUp({ vehicle: undefined })))).toEqual([
      'vehicle',
    ]);
  });

  it('refuses a passenger who sends a Tesla', async () => {
    const res = await signUp(passengerSignUp({ vehicle: { name: 'Bullet', capacity: 3 } }));
    expect(await validationPaths(res)).toEqual(['vehicle']);
  });

  it('requires gender (FR-P1)', async () => {
    expect(await validationPaths(await signUp(passengerSignUp({ gender: undefined })))).toEqual([
      'gender',
    ]);
  });

  it.each([0, 7, 2.5])('refuses a Tesla with %s seats', async (capacity) => {
    const res = await signUp(driverSignUp({ vehicle: { name: 'Bullet', capacity } }));
    expect(await validationPaths(res)).toEqual(['vehicle.capacity']);
  });

  it('refuses a password over the 72-byte bcrypt limit', async () => {
    const res = await signUp(passengerSignUp({ password: 'ব'.repeat(25) }));
    expect(await validationPaths(res)).toEqual(['password']);
  });

  it('creates nothing when the input is invalid', async () => {
    await signUp(driverSignUp({ vehicle: { name: 'Bullet', capacity: 9 } }));

    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM users');
    expect(rows[0]?.count).toBe('0');
  });
});

describe('duplicate emails', () => {
  it('answers 409 EMAIL_TAKEN for an email in any case', async () => {
    await signUp(passengerSignUp({ email: 'nusrat@example.com' }));
    const res = await signUp(driverSignUp({ email: 'NUSRAT@example.com' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: 'EMAIL_TAKEN', message: expect.any(String) },
    });
  });

  // The unique constraint decides, so a race can't create two accounts (NFR-20).
  it('lets exactly one of ten simultaneous sign-ups win, every time', async () => {
    for (let round = 0; round < 5; round++) {
      const email = `race-${round}@example.com`;
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => signUp(driverSignUp({ email }))),
      );

      const statuses = responses.map((res) => res.status).sort();
      expect(statuses).toEqual([201, ...Array<number>(9).fill(409)]);
      const { rows } = await pool.query<{ users: string; wallets: string; vehicles: string }>(
        `SELECT
           (SELECT count(*) FROM users WHERE email = $1) AS users,
           (SELECT count(*) FROM wallets w JOIN users u ON u.id = w.user_id WHERE email = $1) AS wallets,
           (SELECT count(*) FROM vehicles v JOIN users u ON u.id = v.driver_id WHERE email = $1) AS vehicles`,
        [email],
      );
      expect(rows[0]).toEqual({ users: '1', wallets: '1', vehicles: '1' });
    }
  });
});

describe('login (FR-P2, FR-D2)', () => {
  beforeEach(async () => {
    await signUp(driverSignUp());
  });

  it('signs in with the right password and returns the account', async () => {
    const res = await logIn('Jashim@Example.com', PASSWORD);

    expect(res.status).toBe(200);
    expect(sessionSetCookie(res)?.value).toBeTruthy();
    const body = (await res.json()) as { user: { email: string }; vehicle: { name: string } };
    expect(body.user.email).toBe('jashim@example.com');
    expect(body.vehicle.name).toBe('Bullet');
  });

  it('gives a wrong password and an unknown email the same answer', async () => {
    const wrongPassword = await logIn('jashim@example.com', 'not-the-password');
    const unknownEmail = await logIn('nobody@example.com', PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const expected = {
      error: { code: 'INVALID_CREDENTIALS', message: 'The email or password is incorrect.' },
    };
    expect(await wrongPassword.json()).toEqual(expected);
    expect(await unknownEmail.json()).toEqual(expected);
    expect(sessionSetCookie(wrongPassword)).toBeUndefined();
  });
});

describe('logout', () => {
  it('clears the session cookie, with or without a session (NFR-37)', async () => {
    const res = await postJson(server, '/api/v1/auth/logout', {});

    expect(res.status).toBe(204);
    const cookie = sessionSetCookie(res);
    expect(cookie?.value).toBe('');
    expect(cookie?.expires?.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
