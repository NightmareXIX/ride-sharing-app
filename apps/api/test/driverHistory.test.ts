import Big from 'big.js';
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
  ageArrival,
  driverAction,
  goOnlineAt,
  requestRide,
  tripFrom,
  type BookingBody,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';
import { fineByLateCancel, topUp } from './support/wallet.js';

let pool: pg.Pool;
let server: TestServer;
let driver: string;
let nusrat: string;
let rafiq: string;
let shirin: string;

interface Earnings {
  total: string;
  cash: string;
  teslapay: string;
}

interface TripSummary {
  id: string;
  passengers: number;
  completed: number;
  earnings: Earnings;
}

interface PastTripBooking {
  id: string;
  passenger: { name: string };
  paymentMethod: string;
  outcome: string;
  fare: { finalFare: string } | null;
  penaltyRecorded: boolean;
}

interface PastTrip extends TripSummary {
  vehicle: { name: string };
  bookings: PastTripBooking[];
}

interface TripPage {
  pools: TripSummary[];
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

async function step(
  booking: BookingBody,
  action: 'arrive' | 'start' | 'complete' | 'cancel' | 'no-show',
) {
  await ok(await driverAction(server, driver, booking.id, action));
}

async function accept(booking: BookingBody) {
  await ok(await acceptRequest(server, driver, booking.id));
}

async function tripPage(query = '', user = driver): Promise<TripPage> {
  return ok(await getJson(server, `/api/v1/driver/pools${query}`, user));
}

async function pastTrip(id: string): Promise<PastTrip> {
  return (await ok<{ pool: PastTrip }>(await getJson(server, `/api/v1/driver/pools/${id}`, driver)))
    .pool;
}

async function earnings(): Promise<Earnings & { rides: number }> {
  const body = await ok<{ earnings: Earnings & { rides: number } }>(
    await getJson(server, '/api/v1/driver/earnings', driver),
  );
  return body.earnings;
}

async function activeTripId(): Promise<string> {
  const body = await ok<{ pool: { id: string } }>(
    await getJson(server, '/api/v1/driver/pool', driver),
  );
  return body.pool.id;
}

// The story (phase 5 LLD §7) with Nusrat paying by TeslaPay and Rafiq in cash.
async function pooledStory() {
  await topUp(server, nusrat, '100.00');
  const nusrats = await requestRide(
    server,
    nusrat,
    tripFrom(BANANI, { paymentMethod: 'teslapay' }),
  );
  await accept(nusrats);
  const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
  await accept(rafiqs);
  const tripId = await activeTripId();
  await step(nusrats, 'arrive');
  await step(nusrats, 'start');
  await step(rafiqs, 'arrive');
  await step(rafiqs, 'start');
  await step(nusrats, 'complete');
  await step(rafiqs, 'complete');
  return { tripId, nusrats, rafiqs };
}

// A trip that ends with no earnings: the passenger cancels for free after the accept.
async function cancelledTrip(passenger: string): Promise<string> {
  const booking = await requestRide(server, passenger, tripFrom(BANANI));
  await accept(booking);
  const tripId = await activeTripId();
  await ok(await postJson(server, `/api/v1/bookings/${booking.id}/cancel`, {}, passenger));
  return tripId;
}

describe("A driver's past trips (FR-D15)", () => {
  it('lists nothing and earns nothing before a trip finishes', async () => {
    expect(await tripPage()).toEqual({ pools: [], nextCursor: null });
    expect(await earnings()).toEqual({ total: '0.00', cash: '0.00', teslapay: '0.00', rides: 0 });
  });

  it("shows Nusrat and Rafiq's shared trip with both fares", async () => {
    const { tripId, nusrats, rafiqs } = await pooledStory();
    const summary = {
      id: tripId,
      passengers: 2,
      completed: 2,
      earnings: { total: '123.44', cash: '71.42', teslapay: '52.02' },
    };
    expect((await tripPage()).pools).toEqual([expect.objectContaining(summary)]);

    const trip = await pastTrip(tripId);
    expect(trip).toMatchObject({ ...summary, vehicle: { name: 'Bullet' } });
    expect(
      trip.bookings.map((b) => [b.id, b.passenger.name, b.outcome, b.fare?.finalFare]),
    ).toEqual([
      [nusrats.id, 'Nusrat', 'completed', '52.02'],
      [rafiqs.id, 'Rafiq', 'completed', '71.42'],
    ]);
    // The driver sees names and fares, never a passenger's gender or fine (NFR-9).
    const text = JSON.stringify(trip);
    expect(text).not.toContain('gender');
    expect(text).not.toContain('fine');
  });

  it('leaves the trip in progress out, and hides it by id', async () => {
    const booking = await requestRide(server, nusrat, tripFrom(BANANI));
    await accept(booking);
    const tripId = await activeTripId();

    expect((await tripPage()).pools).toEqual([]);
    expect((await getJson(server, `/api/v1/driver/pools/${tripId}`, driver)).status).toBe(404);
    expect((await getJson(server, '/api/v1/driver/pools/not-a-uuid', driver)).status).toBe(404);
  });

  it("keeps a driver out of another driver's trips (NFR-8)", async () => {
    const tripId = await cancelledTrip(nusrat);
    const other = await signUpAs(
      server,
      driverSignUp({
        name: 'Karim',
        email: 'karim@example.com',
        vehicle: { name: 'Comet', capacity: 4 },
      }),
    );

    expect((await getJson(server, `/api/v1/driver/pools/${tripId}`, other)).status).toBe(404);
    expect((await tripPage('', other)).pools).toEqual([]);
  });

  it('refuses passengers and the signed-out', async () => {
    for (const path of ['/api/v1/driver/pools', '/api/v1/driver/earnings']) {
      expect((await getJson(server, path, nusrat)).status).toBe(403);
      expect((await getJson(server, path)).status).toBe(401);
    }
  });
});

describe('How each passenger left the trip', () => {
  it('shows a drop by the driver, with a penalty only when it was late (FR-D13)', async () => {
    const booking = await requestRide(server, nusrat, tripFrom(BANANI));
    await accept(booking);
    const early = await activeTripId();
    await step(booking, 'cancel');

    await accept(booking);
    const late = await activeTripId();
    await ageAcceptance(pool, booking.id, '3 minutes 1 second');
    await step(booking, 'cancel');

    for (const [tripId, penaltyRecorded] of [
      [early, false],
      [late, true],
    ] as const) {
      const trip = await pastTrip(tripId);
      expect(trip).toMatchObject({ passengers: 1, completed: 0, earnings: { total: '0.00' } });
      expect(trip.bookings).toEqual([
        expect.objectContaining({
          id: booking.id,
          outcome: 'driver_cancelled',
          fare: null,
          penaltyRecorded,
        }),
      ]);
    }
  });

  it('shows cancels and no-shows, which earn nothing', async () => {
    const free = await cancelledTrip(shirin);

    const noShow = await requestRide(server, rafiq, tripFrom(BANANI));
    await accept(noShow);
    const noShowTrip = await activeTripId();
    await step(noShow, 'arrive');
    await ageArrival(pool, noShow.id, '5 minutes 1 second');
    await step(noShow, 'no-show');

    await fineByLateCancel(server, pool, driver, nusrat);
    const [lateTrip] = (await tripPage()).pools;

    const outcomes = await Promise.all(
      [free, noShowTrip, lateTrip?.id ?? ''].map(async (id) => {
        const trip = await pastTrip(id);
        expect(trip.earnings).toEqual({ total: '0.00', cash: '0.00', teslapay: '0.00' });
        return trip.bookings.map((b) => b.outcome);
      }),
    );
    expect(outcomes).toEqual([['passenger_cancelled'], ['no_show'], ['late_cancel']]);
    expect(await earnings()).toMatchObject({ total: '0.00', rides: 0 });
  });

  it('shows a passenger dropped and taken back as two entries', async () => {
    const nusrats = await requestRide(server, nusrat, tripFrom(BANANI));
    await accept(nusrats);
    const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    await accept(rafiqs);
    const tripId = await activeTripId();
    await step(rafiqs, 'cancel');
    await accept(rafiqs);
    expect(await activeTripId()).toBe(tripId);

    await step(nusrats, 'arrive');
    await step(nusrats, 'start');
    await step(rafiqs, 'arrive');
    await step(rafiqs, 'start');
    await step(nusrats, 'complete');
    await step(rafiqs, 'complete');

    const trip = await pastTrip(tripId);
    expect(trip).toMatchObject({ passengers: 3, completed: 2 });
    expect(trip.bookings.map((b) => [b.passenger.name, b.outcome])).toEqual([
      ['Rafiq', 'driver_cancelled'],
      ['Nusrat', 'completed'],
      ['Rafiq', 'completed'],
    ]);
  });
});

describe('Paging past trips (NFR-36)', () => {
  it('visits every trip once, newest first', async () => {
    const made = [
      await cancelledTrip(nusrat),
      await cancelledTrip(rafiq),
      await cancelledTrip(shirin),
    ];

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: TripPage = await tripPage(`?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.pools.length).toBe(1);
      seen.push(...page.pools.map((p) => p.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...made].reverse());
  });

  it('refuses a bad cursor or limit', async () => {
    for (const query of ['?cursor=nonsense', '?limit=51', '?limit=0']) {
      const res = await getJson(server, `/api/v1/driver/pools${query}`, driver);
      expect(res.status, query).toBe(400);
    }
  });
});

describe("The driver's earnings", () => {
  it('splits cash and TeslaPay, and agrees with the trips and the ledger', async () => {
    await pooledStory();
    await cancelledTrip(shirin);
    await fineByLateCancel(server, pool, driver, shirin);

    const totals = await earnings();
    expect(totals).toEqual({ total: '123.44', cash: '71.42', teslapay: '52.02', rides: 2 });

    const trips = (await tripPage('?limit=50')).pools;
    const byTrips = trips.reduce((sum, t) => sum.plus(t.earnings.total), new Big(0));
    const { rows } = await pool.query<{ sum: string }>(
      `SELECT coalesce(sum(t.amount), 0) AS sum FROM wallet_transactions t
       JOIN wallets w ON w.id = t.wallet_id JOIN users u ON u.id = w.user_id
       WHERE u.email = 'jashim@example.com' AND t.type IN ('cash_earning', 'driver_credit')`,
    );
    expect(byTrips.toFixed(2)).toBe(totals.total);
    expect(new Big(rows[0]?.sum ?? '0').toFixed(2)).toBe(totals.total);
  });

  it('counts rides completed before the ledger existed, as their trips do', async () => {
    await pooledStory();
    // Rides completed before phase 6 have a fare but no ledger entry. TRUNCATE skips the
    // append-only trigger.
    await pool.query('TRUNCATE wallet_transactions');

    expect(await earnings()).toEqual({
      total: '123.44',
      cash: '71.42',
      teslapay: '52.02',
      rides: 2,
    });
  });
});
