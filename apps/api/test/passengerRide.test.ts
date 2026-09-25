import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import {
  driverSignUp,
  getJson,
  passengerSignUp,
  postJson,
  resetDb,
  signUpAs,
} from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import {
  acceptRequest,
  driverAction,
  errorCode,
  goOnlineAt,
  requestRide,
  type BookingBody,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';

let pool: pg.Pool;
let server: TestServer;
let driver: string;
let nusrat: string;
let booking: BookingBody;

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
  driver = await signUpAs(server, driverSignUp());
  nusrat = await signUpAs(server, passengerSignUp());
  await goOnlineAt(server, driver);
  booking = await requestRide(server, nusrat);
});

async function current(): Promise<BookingBody | null> {
  const res = await getJson(server, '/api/v1/bookings/current', nusrat);
  expect(res.status).toBe(200);
  return ((await res.json()) as { booking: BookingBody | null }).booking;
}

async function byId(): Promise<BookingBody> {
  const res = await getJson(server, `/api/v1/bookings/${booking.id}`, nusrat);
  expect(res.status).toBe(200);
  return ((await res.json()) as { booking: BookingBody }).booking;
}

describe('what a passenger sees of their ride (FR-P5)', () => {
  it('names the driver and the Tesla once accepted, and nothing more about them', async () => {
    await acceptRequest(server, driver, booking.id);

    const seen = await current();
    expect(seen).toMatchObject({
      status: 'ACCEPTED',
      driver: { name: 'Jashim' },
      vehicle: { name: 'Bullet' },
      arrivedAt: null,
      notice: null,
      fare: null,
    });
    expect(seen?.driver).toEqual({ name: 'Jashim' });
  });

  it('shows the free-cancel deadline, 3 minutes after acceptance by the database clock', async () => {
    await acceptRequest(server, driver, booking.id);

    const seen = await current();
    const acceptedAt = Date.parse(seen?.acceptedAt as string);
    const freeUntil = Date.parse(seen?.freeCancelUntil as string);
    expect(freeUntil - acceptedAt).toBe(3 * 60 * 1000);
  });

  it('follows each step the driver takes', async () => {
    await acceptRequest(server, driver, booking.id);
    await driverAction(server, driver, booking.id, 'arrive');
    expect(await current()).toMatchObject({
      status: 'DRIVER_ARRIVED',
      arrivedAt: expect.any(String),
    });

    await driverAction(server, driver, booking.id, 'start');
    expect(await current()).toMatchObject({ status: 'STARTED', startedAt: expect.any(String) });
  });

  it('shows the fare breakdown once the ride is complete (FR-P11)', async () => {
    await acceptRequest(server, driver, booking.id);
    for (const action of ['arrive', 'start', 'complete'] as const) {
      await driverAction(server, driver, booking.id, action);
    }

    // A finished ride is no longer current, so the screen reads it by id.
    expect(await current()).toBeNull();
    const done = await byId();
    expect(done).toMatchObject({
      status: 'COMPLETED',
      completedAt: expect.any(String),
      fare: {
        actualKm: booking.directKm,
        sharedKm: '0.000',
        finalFare: booking.estimatedFare,
      },
    });

    // /me agrees: nothing in progress.
    const me = (await (await getJson(server, '/api/v1/me', nusrat)).json()) as {
      currentBooking: unknown;
    };
    expect(me.currentBooking).toBeNull();
  });

  it('says why the ride is waiting again after the driver cancels', async () => {
    await acceptRequest(server, driver, booking.id);
    await driverAction(server, driver, booking.id, 'cancel');

    expect(await current()).toMatchObject({
      status: 'REQUESTED',
      notice: 'driver_cancelled',
      driver: null,
      vehicle: null,
      acceptedAt: null,
      freeCancelUntil: null,
    });

    // Once another driver takes it, the notice is gone.
    await acceptRequest(server, driver, booking.id);
    expect(await current()).toMatchObject({ status: 'ACCEPTED', notice: null });
  });

  it("keeps another passenger's ride hidden (FR-P9, NFR-8)", async () => {
    const rafiq = await signUpAs(
      server,
      passengerSignUp({ name: 'Rafiq', email: 'rafiq@example.com', gender: 'male' }),
    );
    await acceptRequest(server, driver, booking.id);

    const res = await getJson(server, `/api/v1/bookings/${booking.id}`, rafiq);
    expect(res.status).toBe(404);
  });
});

describe('cancelling after a driver accepts (FR-P7)', () => {
  function cancel() {
    return postJson(server, `/api/v1/bookings/${booking.id}/cancel`, {}, nusrat);
  }

  async function lastReason(): Promise<string | undefined> {
    const { rows } = await pool.query<{ reason: string }>(
      `SELECT reason FROM booking_status_history
       WHERE booking_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [booking.id],
    );
    return rows[0]?.reason;
  }

  it.each([
    ['after acceptance', []],
    ['after the driver arrives', ['arrive']],
  ] as const)('is free within 3 minutes, %s', async (_name, before) => {
    await acceptRequest(server, driver, booking.id);
    for (const action of before) await driverAction(server, driver, booking.id, action);

    const res = await cancel();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { booking: BookingBody }).booking).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: expect.any(String),
      // The ride keeps the driver it was cancelled from.
      driver: { name: 'Jashim' },
    });
    expect(await lastReason()).toBe('passenger_cancel');
  });

  it('is recorded as late more than 3 minutes after acceptance, by the database clock', async () => {
    await acceptRequest(server, driver, booking.id);
    // Only the database clock counts (NFR-38), so the acceptance is moved back in SQL.
    await pool.query(
      "UPDATE bookings SET accepted_at = now() - interval '3 minutes 1 second' WHERE id = $1",
      [booking.id],
    );

    expect((await cancel()).status).toBe(200);
    expect(await lastReason()).toBe('late_cancel');
  });

  it("ends the driver's trip and frees the Tesla", async () => {
    await acceptRequest(server, driver, booking.id);
    await cancel();

    const { rows } = await pool.query<{ status: string }>('SELECT status FROM pools');
    expect(rows).toEqual([{ status: 'finished' }]);
    expect(await (await getJson(server, '/api/v1/driver/pool', driver)).json()).toEqual({
      pool: null,
    });
  });

  it('is refused once the trip has started (FR-R8)', async () => {
    await acceptRequest(server, driver, booking.id);
    await driverAction(server, driver, booking.id, 'arrive');
    await driverAction(server, driver, booking.id, 'start');

    const res = await cancel();
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('INVALID_TRANSITION');
    expect((await byId()).status).toBe('STARTED');
  });

  it('is refused once the ride has finished (FR-R8)', async () => {
    await acceptRequest(server, driver, booking.id);
    for (const action of ['arrive', 'start', 'complete'] as const) {
      await driverAction(server, driver, booking.id, action);
    }

    const res = await cancel();
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('INVALID_TRANSITION');
    expect((await byId()).status).toBe('COMPLETED');
  });

  it('is safe to press twice (NFR-37)', async () => {
    await acceptRequest(server, driver, booking.id);
    await cancel();

    expect((await cancel()).status).toBe(200);
    const { rows } = await pool.query(
      "SELECT id FROM booking_status_history WHERE to_status = 'CANCELLED'",
    );
    expect(rows).toHaveLength(1);
  });
});
