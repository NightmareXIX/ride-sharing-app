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
  BANANI,
  GULSHAN_1,
  acceptRequest,
  ageAcceptance,
  driverAction,
  goOnlineAt,
  requestRide,
  tripFrom,
  type BookingBody,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';
import { topUp } from './support/wallet.js';

let pool: pg.Pool;
let server: TestServer;
let driver: string;
let nusrat: string;
let rafiq: string;
let shirin: string;

interface HistoryBooking extends BookingBody {
  fare: Record<string, unknown> | null;
  fine: { amount: string; reason: string } | null;
}

interface RidePage {
  bookings: HistoryBooking[];
  nextCursor: string | null;
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
  shirin = await signUpAs(server, passengerSignUp({ name: 'Shirin', email: 'shirin@example.com' }));
  await goOnlineAt(server, driver, BANANI);
});

async function ok<T>(res: Response): Promise<T> {
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function history(user: string, query = ''): Promise<RidePage> {
  return ok(await getJson(server, `/api/v1/bookings${query}`, user));
}

async function step(booking: BookingBody, action: 'arrive' | 'start' | 'complete') {
  await ok(await driverAction(server, driver, booking.id, action));
}

async function accept(booking: BookingBody) {
  await ok(await acceptRequest(server, driver, booking.id));
}

function cancel(booking: BookingBody, passenger: string) {
  return postJson(server, `/api/v1/bookings/${booking.id}/cancel`, {}, passenger);
}

async function completedRide(passenger: string, trip = tripFrom(BANANI)): Promise<BookingBody> {
  const booking = await requestRide(server, passenger, trip);
  await accept(booking);
  await step(booking, 'arrive');
  await step(booking, 'start');
  await step(booking, 'complete');
  return booking;
}

// The stored breakdown of a completed ride, as the database holds it.
async function storedFare(bookingId: string) {
  const { rows } = await pool.query<Record<string, string>>(
    `SELECT pickup_odometer_km, dropoff_odometer_km, actual_km, shared_km, computed_fare,
       estimated_fare, final_fare
     FROM fares WHERE booking_id = $1`,
    [bookingId],
  );
  const row = rows[0];
  if (!row) throw new Error(`No fare for ${bookingId}`);
  return {
    pickupOdometerKm: row.pickup_odometer_km,
    dropoffOdometerKm: row.dropoff_odometer_km,
    actualKm: row.actual_km,
    sharedKm: row.shared_km,
    computedFare: row.computed_fare,
    estimatedFare: row.estimated_fare,
    finalFare: row.final_fare,
  };
}

describe("A passenger's past rides (FR-P6)", () => {
  it('is empty for a new passenger', async () => {
    expect(await history(nusrat)).toEqual({ bookings: [], nextCursor: null });
  });

  it('lists ended rides newest first, each with its fare or fine', async () => {
    const completed = await completedRide(nusrat);

    const free = await requestRide(server, nusrat, tripFrom(BANANI));
    expect((await cancel(free, nusrat)).status).toBe(200);

    const late = await requestRide(server, nusrat, tripFrom(BANANI));
    await accept(late);
    await ageAcceptance(pool, late.id, '3 minutes 1 second');
    expect((await cancel(late, nusrat)).status).toBe(200);

    // The fine took her below zero; after a top-up she rides again, and that ride is current.
    await topUp(server, nusrat, '30.00');
    const current = await requestRide(server, nusrat, tripFrom(BANANI));

    const { bookings } = await history(nusrat);
    expect(bookings.map((b) => [b.id, b.status])).toEqual([
      [late.id, 'CANCELLED'],
      [free.id, 'CANCELLED'],
      [completed.id, 'COMPLETED'],
    ]);
    expect(bookings.map((b) => b.id)).not.toContain(current.id);

    const [lateRide, freeRide, completedRow] = bookings;
    expect(lateRide?.fine).toEqual({ amount: '30.00', reason: 'late_cancel' });
    expect(lateRide?.fare).toBeNull();
    expect(freeRide?.fine).toBeNull();
    expect(completedRow?.fine).toBeNull();
    expect(completedRow?.fare).toMatchObject(await storedFare(completed.id));
    expect(completedRow?.fare).toMatchObject({ finalFare: '66.70', sharedKm: '0.000' });
  });

  it('visits every ride once when paged', async () => {
    const made: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const booking = await requestRide(server, nusrat, tripFrom(BANANI));
      expect((await cancel(booking, nusrat)).status).toBe(200);
      made.push(booking.id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: RidePage = await history(nusrat, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.bookings.length).toBe(1);
      seen.push(...page.bookings.map((b) => b.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...made].reverse());
  });

  it('refuses a bad cursor or limit', async () => {
    for (const query of ['?cursor=nonsense', '?limit=51', '?limit=0']) {
      expect((await getJson(server, `/api/v1/bookings${query}`, nusrat)).status, query).toBe(400);
    }
  });
});

describe('Privacy of ride history (FR-P8, FR-P9, NFR-8, NFR-9)', () => {
  it("never shows Nusrat anything about Rafiq's share of the pool", async () => {
    const nusrats = await requestRide(server, nusrat, tripFrom(BANANI));
    await accept(nusrats);
    const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    await accept(rafiqs);
    await step(nusrats, 'arrive');
    await step(nusrats, 'start');
    await step(rafiqs, 'arrive');
    await step(rafiqs, 'start');
    await step(nusrats, 'complete');
    await step(rafiqs, 'complete');

    const page = await history(nusrat);
    expect(page.bookings.map((b) => b.fare?.finalFare)).toEqual(['52.02']);
    const text = JSON.stringify(page);
    for (const secret of ['Rafiq', rafiqs.id, '71.42', 'Gulshan 1']) {
      expect(text).not.toContain(secret);
    }
  });

  it("keeps each passenger's rides to themselves", async () => {
    const ride = await completedRide(nusrat);

    expect((await history(shirin)).bookings).toEqual([]);
    expect((await getJson(server, `/api/v1/bookings/${ride.id}`, shirin)).status).toBe(404);
  });

  it('refuses drivers and the signed-out', async () => {
    expect((await getJson(server, '/api/v1/bookings', driver)).status).toBe(403);
    expect((await getJson(server, '/api/v1/bookings')).status).toBe(401);
  });
});
