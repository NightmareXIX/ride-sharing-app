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

interface TripBody {
  pool: { id: string; bookings: Array<{ id: string; status: string; nextAction: string }> } | null;
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
  await goOnlineAt(server, driver);
  booking = await requestRide(server, nusrat);
  expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);
});

async function stepTo(action: 'arrive' | 'start' | 'complete'): Promise<TripBody> {
  const res = await driverAction(server, driver, booking.id, action);
  expect(res.status).toBe(200);
  return (await res.json()) as TripBody;
}

async function bookingRow() {
  const { rows } = await pool.query<{
    status: string;
    arrived_at: Date | null;
    started_at: Date | null;
    completed_at: Date | null;
    pool_id: string;
  }>('SELECT status, arrived_at, started_at, completed_at, pool_id FROM bookings WHERE id = $1', [
    booking.id,
  ]);
  const [row] = rows;
  if (!row) throw new Error('booking not found');
  return row;
}

async function historyReasons(): Promise<string[]> {
  const { rows } = await pool.query<{ reason: string }>(
    'SELECT reason FROM booking_status_history WHERE booking_id = $1 ORDER BY created_at, id',
    [booking.id],
  );
  return rows.map((r) => r.reason);
}

describe('a single ride, pickup to drop-off (FR-D10)', () => {
  it('moves through arrive, start and complete, recording each step', async () => {
    const arrived = await stepTo('arrive');
    expect(arrived.pool?.bookings[0]).toMatchObject({
      status: 'DRIVER_ARRIVED',
      nextAction: 'start',
    });
    expect((await bookingRow()).arrived_at).toBeInstanceOf(Date);

    const started = await stepTo('start');
    expect(started.pool?.bookings[0]).toMatchObject({ status: 'STARTED', nextAction: 'complete' });
    expect((await bookingRow()).started_at).toBeInstanceOf(Date);

    const res = await driverAction(server, driver, booking.id, 'complete');
    expect(res.status).toBe(200);
    const done = (await res.json()) as TripBody & { fare: Record<string, unknown> };
    // The trip is over, so there is nothing left to show.
    expect(done.pool).toBeNull();
    expect(done.fare.finalFare).toBe(booking.estimatedFare);

    const row = await bookingRow();
    expect(row.status).toBe('COMPLETED');
    expect(row.completed_at).toBeInstanceOf(Date);
    expect(await historyReasons()).toEqual([
      'requested',
      'accepted',
      'driver_arrived',
      'started',
      'completed',
    ]);
  });

  it('records a fare that checks by hand (FR-F6)', async () => {
    await stepTo('arrive');
    await stepTo('start');
    const res = await driverAction(server, driver, booking.id, 'complete');
    const { fare } = (await res.json()) as { fare: Record<string, unknown> };

    // A single ride goes straight from pickup to destination with nobody to share.
    expect(fare).toEqual({
      pickupOdometerKm: '0.000',
      dropoffOdometerKm: booking.directKm,
      actualKm: booking.directKm,
      sharedKm: '0.000',
      directKm: booking.directKm,
      distanceMethod: 'fallback',
      baseFare: '30.00',
      perKmRate: '20.00',
      sharedKmDiscount: '8.00',
      seats: 1,
      seatMultiplier: '1.00',
      rideOption: 'pool',
      optionMultiplier: '1.00',
      estimatedFare: booking.estimatedFare,
      computedFare: booking.estimatedFare,
      finalFare: booking.estimatedFare,
    });
  });

  it('ends the trip, so the driver can take another ride or go offline', async () => {
    await stepTo('arrive');
    await stepTo('start');
    await stepTo('complete');

    const { rows } = await pool.query<{ status: string; finished_at: Date | null }>(
      'SELECT status, finished_at FROM pools',
    );
    expect(rows).toEqual([{ status: 'finished', finished_at: expect.any(Date) as Date }]);
    expect(await (await getJson(server, '/api/v1/driver/pool', driver)).json()).toEqual({
      pool: null,
    });
    expect((await postJson(server, '/api/v1/driver/vehicle/offline', {}, driver)).status).toBe(200);
  });

  it('treats a repeated step as the same step (NFR-37)', async () => {
    await stepTo('arrive');
    await stepTo('arrive');
    await stepTo('start');
    await stepTo('start');
    await stepTo('complete');
    const again = await driverAction(server, driver, booking.id, 'complete');
    expect(again.status).toBe(200);
    expect(((await again.json()) as { fare: { finalFare: string } }).fare.finalFare).toBe(
      booking.estimatedFare,
    );

    expect(await historyReasons()).toHaveLength(5);
    const { rows } = await pool.query('SELECT id FROM fares');
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['start before arriving', 'start'],
    ['complete before arriving', 'complete'],
  ] as const)('refuses to %s (FR-R8)', async (_name, action) => {
    const res = await driverAction(server, driver, booking.id, action);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('INVALID_TRANSITION');
    expect((await bookingRow()).status).toBe('ACCEPTED');
    expect(await historyReasons()).toEqual(['requested', 'accepted']);
  });

  it('refuses to complete a ride that has not started', async () => {
    await stepTo('arrive');
    const res = await driverAction(server, driver, booking.id, 'complete');
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('INVALID_TRANSITION');
  });

  it("hides another driver's passenger (NFR-8)", async () => {
    const other = await signUpAs(
      server,
      driverSignUp({
        name: 'Karim',
        email: 'karim@example.com',
        vehicle: { name: 'Arrow', capacity: 3 },
      }),
    );

    for (const action of ['arrive', 'start', 'complete'] as const) {
      const res = await driverAction(server, other, booking.id, action);
      expect(res.status).toBe(404);
    }
    expect((await bookingRow()).status).toBe('ACCEPTED');
  });

  it('never lets a passenger move their own ride along (FR-R8)', async () => {
    for (const action of ['arrive', 'start', 'complete'] as const) {
      expect((await driverAction(server, nusrat, booking.id, action)).status).toBe(403);
    }
  });

  it('answers a malformed id with 404', async () => {
    const res = await postJson(server, '/api/v1/driver/bookings/not-a-uuid/arrive', {}, driver);
    expect(res.status).toBe(404);
  });
});

describe('recorded fares (NFR-41)', () => {
  it('can never be changed or deleted', async () => {
    await stepTo('arrive');
    await stepTo('start');
    await stepTo('complete');

    await expect(pool.query("UPDATE fares SET final_fare = '1.00'")).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM fares')).rejects.toThrow(/append-only/);
  });
});
