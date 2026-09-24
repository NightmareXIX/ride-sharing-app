import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, signSession } from '../src/auth/session.js';
import { createPool } from '../src/db/client.js';
import { requireAuth, requireRole } from '../src/http/middleware/auth.js';
import { errorHandler } from '../src/http/middleware/errorHandler.js';
import { driverSignUp, passengerSignUp, resetDb, signUpAs } from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import { startTestServer, TEST_SESSION_SECRET, type TestServer } from './support/server.js';

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

function getMe(cookie?: string) {
  return fetch(server.url('/api/v1/me'), { headers: cookie ? { Cookie: cookie } : {} });
}

async function expectUnauthenticated(res: Response) {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({
    error: { code: 'UNAUTHENTICATED', message: expect.any(String) },
  });
}

describe('GET /me', () => {
  it("returns a driver's account with their Tesla and wallet", async () => {
    const cookie = await signUpAs(server, driverSignUp());
    const res = await getMe(cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: {
        id: expect.any(String),
        name: 'Jashim',
        email: 'jashim@example.com',
        gender: 'male',
        role: 'driver',
        createdAt: expect.any(String),
      },
      wallet: { balance: '0.00' },
      vehicle: { id: expect.any(String), name: 'Bullet', capacity: 3 },
    });
  });

  it('returns no vehicle for a passenger', async () => {
    const cookie = await signUpAs(server, passengerSignUp());
    const body = (await (await getMe(cookie)).json()) as { vehicle: unknown };
    expect(body.vehicle).toBeNull();
  });

  it('never exposes the password hash (NFR-9)', async () => {
    const cookie = await signUpAs(server, passengerSignUp());
    const text = await (await getMe(cookie)).text();
    expect(text).not.toMatch(/password/i);
    expect(text).not.toContain('$2');
  });
});

describe('session checks (NFR-6, NFR-8)', () => {
  it('rejects a request with no cookie', async () => {
    await expectUnauthenticated(await getMe());
  });

  it('rejects a tampered token', async () => {
    const cookie = await signUpAs(server, passengerSignUp());
    // Flip the role claim to driver without re-signing.
    const [header, payload, signature] = cookie.split('=')[1]!.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as object;
    const forged = Buffer.from(JSON.stringify({ ...claims, role: 'driver' })).toString('base64url');

    await expectUnauthenticated(await getMe(`${SESSION_COOKIE}=${header}.${forged}.${signature}`));
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signSession(
      { userId: crypto.randomUUID(), role: 'passenger' },
      'some-other-secret-that-is-long-enough-0000',
    );
    await expectUnauthenticated(await getMe(`${SESSION_COOKIE}=${token}`));
  });

  it('rejects a token older than 24 hours', async () => {
    const res = await fetch(server.url('/api/v1/auth/signup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(passengerSignUp()),
    });
    const { user } = (await res.json()) as { user: { id: string } };
    const dayAndAMinuteAgo = new Date(Date.now() - (24 * 60 + 1) * 60 * 1000);
    const token = await signSession(
      { userId: user.id, role: 'passenger' },
      TEST_SESSION_SECRET,
      dayAndAMinuteAgo,
    );

    await expectUnauthenticated(await getMe(`${SESSION_COOKIE}=${token}`));
  });

  it('treats a valid token for a missing account as signed out', async () => {
    const token = await signSession(
      { userId: crypto.randomUUID(), role: 'passenger' },
      TEST_SESSION_SECRET,
    );
    await expectUnauthenticated(await getMe(`${SESSION_COOKIE}=${token}`));
  });
});

describe('role checks (NFR-8)', () => {
  let roleServer: Server;
  let driverOnlyUrl: string;

  // No phase 1 route is limited to one role yet, so mount the guard on a tiny app.
  beforeAll(async () => {
    const app = express();
    app.get(
      '/driver-only',
      requireAuth(TEST_SESSION_SECRET),
      requireRole('driver'),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    app.use(errorHandler);
    roleServer = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    driverOnlyUrl = `http://127.0.0.1:${(roleServer.address() as AddressInfo).port}/driver-only`;
  });

  afterAll(async () => {
    await new Promise((resolve) => roleServer.close(resolve));
  });

  async function asRole(role: 'driver' | 'passenger') {
    const token = await signSession({ userId: crypto.randomUUID(), role }, TEST_SESSION_SECRET);
    return fetch(driverOnlyUrl, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
  }

  it('lets the right role through', async () => {
    expect((await asRole('driver')).status).toBe(200);
  });

  it('answers 403 WRONG_ROLE to the other role', async () => {
    const res = await asRole('passenger');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'WRONG_ROLE', message: expect.any(String) },
    });
  });

  it('answers 401 before checking the role when signed out', async () => {
    await expectUnauthenticated(await fetch(driverOnlyUrl));
  });
});
