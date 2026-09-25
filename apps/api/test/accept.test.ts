import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import {
  driverSignUp,
  getJson,
  passengerSignUp,
  postJson,
  resetDb,
  sendJson,
  signUpAs,
} from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import {
  BANANI,
  GULSHAN_1,
  UTTARA,
  acceptRequest,
  errorCode,
  goOnlineAt,
  nearbyRequestIds,
  requestRide,
  tripFrom,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';

let pool: pg.Pool;
let server: TestServer;
let driver: string;
let nusrat: string;
let rafiq: string;

interface TripBody {
  pool: { id: string; bookings: Array<Record<string, unknown>> } | null;
}

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
  rafiq = await signUpAs(
    server,
    passengerSignUp({ name: 'Rafiq', email: 'rafiq@example.com', gender: 'male' }),
  );
});

async function historyOf(bookingId: string) {
  const { rows } = await pool.query<{
    from_status: string | null;
    to_status: string;
    reason: string;
    pool_id: string | null;
  }>(
    `SELECT from_status, to_status, reason, pool_id FROM booking_status_history
     WHERE booking_id = $1 ORDER BY created_at, id`,
    [bookingId],
  );
  return rows;
}

describe('POST /driver/requests/:id/accept (FR-D8, FR-R4)', () => {
  it('puts the booking in a new trip for the Tesla', async () => {
    await goOnlineAt(server, driver);
    const booking = await requestRide(server, nusrat);

    const res = await acceptRequest(server, driver, booking.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TripBody;
    expect(body.pool?.bookings).toHaveLength(1);
    expect(body.pool?.bookings[0]).toMatchObject({
      id: booking.id,
      passenger: { name: 'Nusrat' },
      status: 'ACCEPTED',
      seats: 1,
      nextAction: 'arrive',
      arrivedAt: null,
    });

    const {
      rows: [row],
    } = await pool.query<{ pool_id: string; accepted_at: Date | null; status: string }>(
      'SELECT pool_id, accepted_at, status FROM bookings WHERE id = $1',
      [booking.id],
    );
    expect(row?.pool_id).toBe(body.pool?.id);
    expect(row?.accepted_at).toBeInstanceOf(Date);

    // The history records the change and the trip it joined (FR-R11).
    expect(await historyOf(booking.id)).toEqual([
      { from_status: null, to_status: 'REQUESTED', reason: 'requested', pool_id: null },
      {
        from_status: 'REQUESTED',
        to_status: 'ACCEPTED',
        reason: 'accepted',
        pool_id: body.pool?.id,
      },
    ]);

    // GET /driver/pool shows the same trip.
    const trip = (await (await getJson(server, '/api/v1/driver/pool', driver)).json()) as TripBody;
    expect(trip.pool?.id).toBe(body.pool?.id);
  });

  it('treats a repeated accept by the same driver as the same accept (FR-C5)', async () => {
    await goOnlineAt(server, driver);
    const booking = await requestRide(server, nusrat);

    const first = (await (await acceptRequest(server, driver, booking.id)).json()) as TripBody;
    const again = await acceptRequest(server, driver, booking.id);
    expect(again.status).toBe(200);
    expect(((await again.json()) as TripBody).pool?.id).toBe(first.pool?.id);

    expect(await historyOf(booking.id)).toHaveLength(2);
    const { rows } = await pool.query('SELECT id FROM pools');
    expect(rows).toHaveLength(1);
  });

  it('lets only one driver claim a request (FR-C2)', async () => {
    const other = await signUpAs(
      server,
      driverSignUp({
        name: 'Karim',
        email: 'karim@example.com',
        vehicle: { name: 'Arrow', capacity: 3 },
      }),
    );
    await goOnlineAt(server, driver);
    await goOnlineAt(server, other);
    const booking = await requestRide(server, nusrat);

    expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);
    const lost = await acceptRequest(server, other, booking.id);
    expect(lost.status).toBe(409);
    expect(await errorCode(lost)).toBe('ALREADY_CLAIMED');
    // The loser changed nothing: no trip of theirs, no extra history.
    expect(
      (await (await getJson(server, '/api/v1/driver/pool', other)).json()) as TripBody,
    ).toEqual({
      pool: null,
    });
    expect(await historyOf(booking.id)).toHaveLength(2);
  });

  it('refuses a driver who is offline', async () => {
    const booking = await requestRide(server, nusrat);
    await sendJson(
      server,
      'PUT',
      '/api/v1/driver/vehicle/location',
      { lat: BANANI.lat, lng: BANANI.lng },
      driver,
    );

    const res = await acceptRequest(server, driver, booking.id);
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('DRIVER_OFFLINE');
  });

  it('adds a second ride to the trip while seats are free (FR-R1)', async () => {
    await goOnlineAt(server, driver);
    const first = await requestRide(server, nusrat);
    const second = await requestRide(server, rafiq, tripFrom(GULSHAN_1));
    const trip = (await (await acceptRequest(server, driver, first.id)).json()) as TripBody;

    // Still listed: Bullet has two seats left.
    expect(await nearbyRequestIds(server, driver)).toEqual([second.id]);
    const res = await acceptRequest(server, driver, second.id);
    expect(res.status).toBe(200);
    const joined = (await res.json()) as TripBody & { pool: { seats: unknown } };
    expect(joined.pool?.id).toBe(trip.pool?.id);
    expect(joined.pool?.seats).toEqual({ capacity: 3, taken: 2 });
    expect(joined.pool?.bookings.map((b) => b.id)).toEqual([first.id, second.id]);
  });

  it('refuses a pickup that is out of range', async () => {
    await goOnlineAt(server, driver, BANANI);
    const booking = await requestRide(server, nusrat, tripFrom(UTTARA));

    const res = await acceptRequest(server, driver, booking.id);
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('NO_LONGER_MATCHES');
  });

  it('refuses a request with more seats than the Tesla has', async () => {
    await signUpAs(
      server,
      driverSignUp({ email: 'big@example.com', vehicle: { name: 'Big', capacity: 6 } }),
    );
    await goOnlineAt(server, driver);
    const booking = await requestRide(server, nusrat, tripFrom(BANANI, { seats: 4 }));

    const res = await acceptRequest(server, driver, booking.id);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('SEATS_UNAVAILABLE');
  });

  it('refuses a request the passenger cancelled', async () => {
    await goOnlineAt(server, driver);
    const booking = await requestRide(server, nusrat);
    await postJson(server, `/api/v1/bookings/${booking.id}/cancel`, {}, nusrat);

    const res = await acceptRequest(server, driver, booking.id);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('INVALID_TRANSITION');
  });

  it('answers an unknown or malformed id with 404', async () => {
    await goOnlineAt(server, driver);

    expect((await acceptRequest(server, driver, crypto.randomUUID())).status).toBe(404);
    expect((await acceptRequest(server, driver, 'not-a-uuid')).status).toBe(404);
  });

  it('is for drivers only', async () => {
    const booking = await requestRide(server, nusrat);

    expect((await acceptRequest(server, nusrat, booking.id)).status).toBe(403);
    expect((await getJson(server, '/api/v1/driver/pool', nusrat)).status).toBe(403);
  });
});

describe('GET /driver/pool (FR-D14)', () => {
  it('is null while the driver has no trip', async () => {
    const res = await getJson(server, '/api/v1/driver/pool', driver);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pool: null });
  });
});
