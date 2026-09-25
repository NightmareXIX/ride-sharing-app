import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import { fallbackRoadKm } from '../src/geo/haversine.js';
import {
  driverSignUp,
  getJson,
  passengerSignUp,
  postJson,
  resetDb,
  signUpAs,
} from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import { startTestServer, type TestServer } from './support/server.js';

const BANANI = { lat: 23.7937, lng: 90.4066, label: 'Banani Road 11' };
const MOHAKHALI = { lat: 23.7781, lng: 90.405, label: 'Mohakhali' };
const GULSHAN_1 = { lat: 23.7806, lng: 90.4163, label: 'Gulshan 1' };

const NUSRAT_TRIP = {
  pickup: BANANI,
  destination: MOHAKHALI,
  seats: 1,
  rideOption: 'pool',
  paymentMethod: 'cash',
};

let pool: pg.Pool;
let server: TestServer;
let nusrat: string;
let driver: string;

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
  // Bullet, 3 seats, is the largest Tesla, so requests for up to 3 seats are allowed.
  driver = await signUpAs(server, driverSignUp());
  nusrat = await signUpAs(server, passengerSignUp());
});

interface Booking {
  id: string;
  status: string;
  estimatedFare: string;
  [key: string]: unknown;
}

function requestRide(body: unknown, cookie = nusrat) {
  return postJson(server, '/api/v1/bookings', body, cookie);
}

async function bookingOf(res: Response, status = 201): Promise<Booking> {
  expect(res.status).toBe(status);
  return ((await res.json()) as { booking: Booking }).booking;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function validationPaths(res: Response): Promise<string[]> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as {
    error: { code: string; details: Array<{ path: string }> };
  };
  expect(body.error.code).toBe('VALIDATION_ERROR');
  return body.error.details.map((detail) => detail.path);
}

async function setBalance(email: string, balance: string): Promise<void> {
  await pool.query(
    'UPDATE wallets SET balance = $1 WHERE user_id = (SELECT id FROM users WHERE email = $2)',
    [balance, email],
  );
}

async function historyOf(bookingId: string) {
  const { rows } = await pool.query<{
    from_status: string | null;
    to_status: string;
    reason: string;
  }>(
    'SELECT from_status, to_status, reason FROM booking_status_history WHERE booking_id = $1 ORDER BY created_at, id',
    [bookingId],
  );
  return rows;
}

describe('fare estimate endpoint (FR-P4)', () => {
  it('prices a trip from its road distance and books nothing', async () => {
    const res = await postJson(
      server,
      '/api/v1/fare-estimates',
      { pickup: BANANI, destination: MOHAKHALI, seats: 2, rideOption: 'same_gender' },
      nusrat,
    );

    expect(res.status).toBe(200);
    // No map key in tests, so the distance is the straight-line fallback (NFR-13).
    const directKm = fallbackRoadKm(BANANI, MOHAKHALI);
    expect(await res.json()).toEqual({
      directKm,
      distanceMethod: 'fallback',
      baseFare: '30.00',
      perKmRate: '20.00',
      seatMultiplier: '1.50',
      optionMultiplier: '1.05',
      estimatedFare: expect.stringMatching(/^\d+\.\d{2}$/),
    });
    const { rows } = await pool.query('SELECT 1 FROM bookings');
    expect(rows).toHaveLength(0);
  });

  it('is for passengers only', async () => {
    const body = { pickup: BANANI, destination: MOHAKHALI, seats: 1, rideOption: 'pool' };

    expect((await postJson(server, '/api/v1/fare-estimates', body, driver)).status).toBe(403);
    expect((await postJson(server, '/api/v1/fare-estimates', body)).status).toBe(401);
  });
});

describe('requesting a ride (FR-P3)', () => {
  it('creates a waiting request with its estimate and a history row', async () => {
    const booking = await bookingOf(await requestRide(NUSRAT_TRIP));

    expect(booking).toEqual({
      id: expect.any(String),
      status: 'REQUESTED',
      pickup: BANANI,
      destination: MOHAKHALI,
      seats: 1,
      rideOption: 'pool',
      paymentMethod: 'cash',
      directKm: fallbackRoadKm(BANANI, MOHAKHALI),
      distanceMethod: 'fallback',
      estimatedFare: expect.stringMatching(/^\d+\.\d{2}$/),
      requestedAt: expect.any(String),
      acceptedAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      freeCancelUntil: null,
      // No driver has it yet.
      driver: null,
      vehicle: null,
      notice: null,
      fare: null,
    });
    expect(await historyOf(booking.id)).toEqual([
      { from_status: null, to_status: 'REQUESTED', reason: 'requested' },
    ]);
  });

  it('stores the same estimate the estimate endpoint quoted', async () => {
    const { paymentMethod: _, ...trip } = NUSRAT_TRIP;
    const quote = (await (
      await postJson(server, '/api/v1/fare-estimates', trip, nusrat)
    ).json()) as { estimatedFare: string };

    expect((await bookingOf(await requestRide(NUSRAT_TRIP))).estimatedFare).toBe(
      quote.estimatedFare,
    );
  });

  it.each([
    ['no seats', { seats: 0 }, 'seats'],
    ['more seats than any Tesla could have', { seats: 7 }, 'seats'],
    ['half a seat', { seats: 1.5 }, 'seats'],
    ['an unknown ride option', { rideOption: 'luxury' }, 'rideOption'],
    ['an unknown payment method', { paymentMethod: 'bkash' }, 'paymentMethod'],
    ['a pickup outside Dhaka', { pickup: { ...BANANI, lat: 22.35 } }, 'pickup.lat'],
    [
      'a destination with no label',
      { destination: { ...MOHAKHALI, label: ' ' } },
      'destination.label',
    ],
    [
      'the same pickup and destination',
      { destination: { ...BANANI, label: 'Also Banani' } },
      'destination',
    ],
  ])('refuses %s (400)', async (_name, change, path) => {
    const res = await requestRide({ ...NUSRAT_TRIP, ...change });

    expect(await validationPaths(res)).toContain(path);
  });

  it('refuses more seats than the largest registered Tesla', async () => {
    const res = await requestRide({ ...NUSRAT_TRIP, seats: 4 });

    expect(await validationPaths(res)).toEqual(['seats']);
  });

  it('refuses TeslaPay when the balance is below the estimate (FR-W3)', async () => {
    const res = await requestRide({ ...NUSRAT_TRIP, paymentMethod: 'teslapay' });

    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('INSUFFICIENT_BALANCE');
  });

  it('accepts TeslaPay when the balance covers the estimate', async () => {
    await setBalance('nusrat@example.com', '500.00');

    const booking = await bookingOf(
      await requestRide({ ...NUSRAT_TRIP, paymentMethod: 'teslapay' }),
    );
    expect(booking.paymentMethod).toBe('teslapay');
  });

  it.each(['cash', 'teslapay'])(
    'refuses a %s request while the balance is negative (FR-W7)',
    async (paymentMethod) => {
      await setBalance('nusrat@example.com', '-30.00');

      const res = await requestRide({ ...NUSRAT_TRIP, paymentMethod });
      expect(res.status).toBe(422);
      expect(await errorCode(res)).toBe('NEGATIVE_BALANCE');
    },
  );

  it('returns the existing request when the same one is sent again (NFR-37)', async () => {
    const first = await bookingOf(await requestRide(NUSRAT_TRIP));
    const second = await bookingOf(await requestRide(NUSRAT_TRIP), 200);

    expect(second).toEqual(first);
    const { rows } = await pool.query('SELECT 1 FROM bookings');
    expect(rows).toHaveLength(1);
  });

  it('refuses a different second request while one is active (FR-P10)', async () => {
    await requestRide(NUSRAT_TRIP);

    const res = await requestRide({ ...NUSRAT_TRIP, destination: GULSHAN_1 });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('ACTIVE_BOOKING_EXISTS');
  });

  it('creates exactly one booking when ten identical requests race (FR-C6)', async () => {
    for (let round = 0; round < 5; round += 1) {
      await pool.query('TRUNCATE bookings CASCADE');

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => requestRide(NUSRAT_TRIP)),
      );
      const bookings = await Promise.all(
        responses.map((res) => res.json() as Promise<{ booking: Booking }>),
      );

      expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
      expect(responses.every((res) => res.status === 201 || res.status === 200)).toBe(true);
      expect(new Set(bookings.map((body) => body.booking.id)).size).toBe(1);
      const { rows } = await pool.query('SELECT 1 FROM booking_status_history');
      expect(rows).toHaveLength(1);
    }
  });

  it('is for passengers only', async () => {
    expect((await requestRide(NUSRAT_TRIP, driver)).status).toBe(403);
    expect((await postJson(server, '/api/v1/bookings', NUSRAT_TRIP)).status).toBe(401);
  });
});

describe('reading a booking (FR-P5, FR-P9)', () => {
  it('shows the active request as current, and on /me', async () => {
    const booking = await bookingOf(await requestRide(NUSRAT_TRIP));

    const current = await getJson(server, '/api/v1/bookings/current', nusrat);
    expect(await current.json()).toEqual({ booking });
    const me = (await (await getJson(server, '/api/v1/me', nusrat)).json()) as {
      currentBooking: unknown;
    };
    expect(me.currentBooking).toEqual(booking);
  });

  it('shows no current booking before any request', async () => {
    const res = await getJson(server, '/api/v1/bookings/current', nusrat);

    expect(await res.json()).toEqual({ booking: null });
  });

  it('shows a passenger their own booking by id', async () => {
    const booking = await bookingOf(await requestRide(NUSRAT_TRIP));

    const res = await getJson(server, `/api/v1/bookings/${booking.id}`, nusrat);
    expect(await res.json()).toEqual({ booking });
  });

  it("hides another passenger's booking as not found (NFR-8)", async () => {
    const booking = await bookingOf(await requestRide(NUSRAT_TRIP));
    const rafiq = await signUpAs(
      server,
      passengerSignUp({ name: 'Rafiq', email: 'rafiq@example.com', gender: 'male' }),
    );

    const res = await getJson(server, `/api/v1/bookings/${booking.id}`, rafiq);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('NOT_FOUND');
    const current = await getJson(server, '/api/v1/bookings/current', rafiq);
    expect(await current.json()).toEqual({ booking: null });
  });

  it('answers an unknown or malformed id with 404', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';

    expect((await getJson(server, `/api/v1/bookings/${unknown}`, nusrat)).status).toBe(404);
    expect((await getJson(server, '/api/v1/bookings/not-an-id', nusrat)).status).toBe(404);
  });

  it('refuses a driver (403) and a visitor with no session (401)', async () => {
    expect((await getJson(server, '/api/v1/bookings/current', driver)).status).toBe(403);
    expect((await getJson(server, '/api/v1/bookings/current')).status).toBe(401);
  });
});

describe('cancelling a waiting request (FR-P7)', () => {
  function cancel(bookingId: string, cookie = nusrat) {
    return postJson(server, `/api/v1/bookings/${bookingId}/cancel`, {}, cookie);
  }

  it('cancels for free and records who did it and why', async () => {
    const { id } = await bookingOf(await requestRide(NUSRAT_TRIP));

    const booking = await bookingOf(await cancel(id), 200);
    expect(booking).toMatchObject({ id, status: 'CANCELLED', cancelledAt: expect.any(String) });
    expect(await historyOf(id)).toEqual([
      { from_status: null, to_status: 'REQUESTED', reason: 'requested' },
      { from_status: 'REQUESTED', to_status: 'CANCELLED', reason: 'passenger_cancel' },
    ]);
  });

  it('is harmless to press twice (NFR-37)', async () => {
    const { id } = await bookingOf(await requestRide(NUSRAT_TRIP));
    const first = await bookingOf(await cancel(id), 200);

    expect(await bookingOf(await cancel(id), 200)).toEqual(first);
    expect(await historyOf(id)).toHaveLength(2);
  });

  it('frees the passenger to request again', async () => {
    const { id } = await bookingOf(await requestRide(NUSRAT_TRIP));
    await cancel(id);

    expect(await (await getJson(server, '/api/v1/bookings/current', nusrat)).json()).toEqual({
      booking: null,
    });
    const next = await bookingOf(await requestRide(NUSRAT_TRIP));
    expect(next.id).not.toBe(id);
  });

  it("can't touch another passenger's booking (FR-P9)", async () => {
    const { id } = await bookingOf(await requestRide(NUSRAT_TRIP));
    const rafiq = await signUpAs(
      server,
      passengerSignUp({ name: 'Rafiq', email: 'rafiq@example.com', gender: 'male' }),
    );

    const res = await cancel(id, rafiq);
    expect(res.status).toBe(404);
    const own = await getJson(server, `/api/v1/bookings/${id}`, nusrat);
    expect(((await own.json()) as { booking: Booking }).booking.status).toBe('REQUESTED');
  });

  it('refuses to cancel a ride that has finished (FR-R8)', async () => {
    const { id } = await bookingOf(await requestRide(NUSRAT_TRIP));
    // No route completes a ride yet, so the state is set directly, in a trip of its own.
    await pool.query(
      `WITH trip AS (INSERT INTO pools (vehicle_id) SELECT id FROM vehicles RETURNING id)
       UPDATE bookings SET status = 'COMPLETED', pool_id = (SELECT id FROM trip),
         accepted_at = now(), arrived_at = now(), started_at = now(), completed_at = now()
       WHERE id = $1`,
      [id],
    );

    const res = await cancel(id);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('INVALID_TRANSITION');
    expect(await historyOf(id)).toHaveLength(1);
  });

  it('is for passengers only', async () => {
    const { id } = await bookingOf(await requestRide(NUSRAT_TRIP));

    expect((await cancel(id, driver)).status).toBe(403);
    expect((await postJson(server, `/api/v1/bookings/${id}/cancel`, {})).status).toBe(401);
  });
});

describe('status history (FR-R11, NFR-40)', () => {
  it('can only be added to: the database refuses UPDATE and DELETE', async () => {
    const { id } = await bookingOf(await requestRide(NUSRAT_TRIP));

    await expect(
      pool.query("UPDATE booking_status_history SET reason = 'edited' WHERE booking_id = $1", [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query('DELETE FROM booking_status_history WHERE booking_id = $1', [id]),
    ).rejects.toThrow(/append-only/);
    expect(await historyOf(id)).toHaveLength(1);
  });
});
