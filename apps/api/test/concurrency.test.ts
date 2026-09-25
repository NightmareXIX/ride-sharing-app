import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import { driverSignUp, passengerSignUp, postJson, resetDb, signUpAs } from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import {
  BANANI,
  GULSHAN_1,
  MOHAKHALI,
  acceptRequest,
  ageAcceptance,
  ageArrival,
  driverAction,
  errorCode,
  expectRouteMatchesBookings,
  expectSeatsMatchBookings,
  goOnlineAt,
  requestRide,
  resetRides,
  seatsTaken,
  tripFrom,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';
import {
  balanceOf,
  entriesFor,
  expectLedgerConsistent,
  postTopUp,
  topUp,
} from './support/wallet.js';

// Timing bugs don't show on every run, so each race is run many times (NFR-28).
const ROUNDS = 25;
const RACE_TIMEOUT_MS = 120_000;

let pool: pg.Pool;
let server: TestServer;
let jashim: string;
let karim: string;
let tariq: string;
let nusrat: string;
let rafiq: string;
let shirin: string;
let farida: string;
let kamal: string;

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL);
  server = await startTestServer(pool);
  await resetDb(pool);
  jashim = await signUpAs(server, driverSignUp());
  karim = await signUpAs(
    server,
    driverSignUp({
      name: 'Karim',
      email: 'karim@example.com',
      vehicle: { name: 'Arrow', capacity: 3 },
    }),
  );
  tariq = await signUpAs(
    server,
    driverSignUp({
      name: 'Tariq',
      email: 'tariq@example.com',
      vehicle: { name: 'Comet', capacity: 3 },
    }),
  );
  nusrat = await signUpAs(server, passengerSignUp());
  rafiq = await signUpAs(
    server,
    passengerSignUp({ name: 'Rafiq', email: 'rafiq@example.com', gender: 'male' }),
  );
  shirin = await signUpAs(server, passengerSignUp({ name: 'Shirin', email: 'shirin@example.com' }));
  farida = await signUpAs(server, passengerSignUp({ name: 'Farida', email: 'farida@example.com' }));
  kamal = await signUpAs(
    server,
    passengerSignUp({ name: 'Kamal', email: 'kamal@example.com', gender: 'male' }),
  );
});

afterAll(async () => {
  await server.close();
  await pool.end();
});

beforeEach(async () => {
  await resetRides(pool);
  await goOnlineAt(server, jashim);
});

async function statusOf(bookingId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>(
    'SELECT status FROM bookings WHERE id = $1',
    [bookingId],
  );
  return rows[0]?.status;
}

async function historyCount(bookingId: string): Promise<number> {
  const { rows } = await pool.query('SELECT 1 FROM booking_status_history WHERE booking_id = $1', [
    bookingId,
  ]);
  return rows.length;
}

// A response and its error code, if it failed.
async function outcome(res: Response): Promise<{ status: number; code: string | null }> {
  return { status: res.status, code: res.ok ? null : await errorCode(res) };
}

describe('the last seat (PRD §14, FR-R3, FR-C1)', () => {
  it(
    'goes to exactly one of Nusrat and Shirin',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { seats: 2 }));
        expect((await acceptRequest(server, jashim, rafiqs.id)).status).toBe(200);
        const nusrats = await requestRide(server, nusrat, tripFrom(BANANI));
        const shirins = await requestRide(server, shirin, tripFrom(BANANI));

        // Both see one seat left, and both accepts go in at once.
        const results = await Promise.all(
          [nusrats, shirins].map(async (b) => outcome(await acceptRequest(server, jashim, b.id))),
        );

        const winners = results.filter((r) => r.status === 200);
        const losers = results.filter((r) => r.status !== 200);
        expect(winners).toHaveLength(1);
        expect(losers).toEqual([{ status: 409, code: 'SEATS_UNAVAILABLE' }]);

        // The loser is untouched: still waiting, with only its request in the history.
        const lost = results[0]?.status === 200 ? shirins : nusrats;
        expect(await statusOf(lost.id)).toBe('REQUESTED');
        expect(await historyCount(lost.id)).toBe(1);
        expect(await seatsTaken(pool)).toBe(3);
        await expectSeatsMatchBookings(pool);
        await expectRouteMatchesBookings(pool);
      }
    },
    RACE_TIMEOUT_MS,
  );
});

describe('many accepts into one Tesla (FR-R2, FR-C3)', () => {
  it(
    'never overfills Bullet, and retries fill it exactly',
    async () => {
      const riders = [nusrat, rafiq, shirin, farida, kamal];
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const requests = [];
        for (const rider of riders) requests.push(await requestRide(server, rider));

        const results = await Promise.all(
          requests.map(async (b) => outcome(await acceptRequest(server, jashim, b.id))),
        );
        const won = results.filter((r) => r.status === 200).length;
        expect(won).toBeGreaterThanOrEqual(1);
        expect(won).toBeLessThanOrEqual(3);
        // An accept that lost is told why: no seat left, or the Tesla changed after its
        // check, which is worth a retry.
        for (const r of results.filter((x) => x.status !== 200)) {
          expect(r.status).toBe(409);
          expect(['SEATS_UNAVAILABLE', 'POOL_CHANGED']).toContain(r.code);
        }
        expect(await seatsTaken(pool)).toBe(won);
        await expectSeatsMatchBookings(pool);
        await expectRouteMatchesBookings(pool);

        // The driver retries each one that was told to try again, one at a time.
        for (const [i, r] of results.entries()) {
          const request = requests[i];
          if (r.code === 'POOL_CHANGED' && request) await acceptRequest(server, jashim, request.id);
        }
        expect(await seatsTaken(pool)).toBe(3);
        await expectSeatsMatchBookings(pool);
        await expectRouteMatchesBookings(pool);
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'keeps seats and the route right when accepts race steps and cancels (FR-C7)',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { seats: 2 }));
        const nusrats = await requestRide(server, nusrat, tripFrom(MOHAKHALI));
        await acceptRequest(server, jashim, rafiqs.id);
        await acceptRequest(server, jashim, nusrats.id);
        await driverAction(server, jashim, nusrats.id, 'arrive');
        const shirins = await requestRide(server, shirin, tripFrom(GULSHAN_1));
        const faridas = await requestRide(server, farida, tripFrom(BANANI));

        // Every path that locks the Tesla and a booking, at once.
        const responses = await Promise.all([
          acceptRequest(server, jashim, shirins.id),
          acceptRequest(server, jashim, faridas.id),
          postJson(server, `/api/v1/bookings/${nusrats.id}/cancel`, {}, nusrat),
          driverAction(server, jashim, rafiqs.id, 'cancel'),
          driverAction(server, jashim, nusrats.id, 'start'),
          postJson(server, `/api/v1/bookings/${rafiqs.id}/cancel`, {}, rafiq),
          postJson(server, `/api/v1/bookings/${shirins.id}/cancel`, {}, shirin),
        ]);

        for (const res of responses) expect(res.status).toBeLessThan(500);
        await expectSeatsMatchBookings(pool);
        await expectRouteMatchesBookings(pool);
        expect(await seatsTaken(pool)).toBeLessThanOrEqual(3);
      }
    },
    RACE_TIMEOUT_MS,
  );
});

describe('one driver per request (FR-R4, FR-C2)', () => {
  it(
    'lets exactly one of three drivers claim a request',
    async () => {
      await goOnlineAt(server, karim);
      await goOnlineAt(server, tariq);
      const drivers = [jashim, karim, tariq];
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const nusrats = await requestRide(server, nusrat);

        const results = await Promise.all(
          drivers.map(async (driver) => outcome(await acceptRequest(server, driver, nusrats.id))),
        );

        expect(results.filter((r) => r.status === 200)).toHaveLength(1);
        expect(results.filter((r) => r.status !== 200)).toEqual([
          { status: 409, code: 'ALREADY_CLAIMED' },
          { status: 409, code: 'ALREADY_CLAIMED' },
        ]);

        // The losers' seat claims and trips were rolled back.
        const { rows: trips } = await pool.query('SELECT id FROM pools');
        expect(trips).toHaveLength(1);
        const { rows: accepted } = await pool.query(
          "SELECT 1 FROM booking_status_history WHERE booking_id = $1 AND reason = 'accepted'",
          [nusrats.id],
        );
        expect(accepted).toHaveLength(1);
        const taken = await Promise.all(
          ['Bullet', 'Arrow', 'Comet'].map((name) => seatsTaken(pool, name)),
        );
        expect(taken.reduce((a, b) => a + b, 0)).toBe(1);
        await expectSeatsMatchBookings(pool);
        await expectRouteMatchesBookings(pool);
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'treats a double-tapped accept as one accept (FR-C5, NFR-37)',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const nusrats = await requestRide(server, nusrat);

        const [first, second] = await Promise.all([
          acceptRequest(server, jashim, nusrats.id),
          acceptRequest(server, jashim, nusrats.id),
        ]);
        expect(first?.status).toBe(200);
        expect(second?.status).toBe(200);
        const ids = await Promise.all(
          [first, second].map(
            async (res) => ((await res?.json()) as { pool: { id: string } }).pool.id,
          ),
        );
        expect(ids[0]).toBe(ids[1]);

        expect(await historyCount(nusrats.id)).toBe(2);
        expect(await seatsTaken(pool)).toBe(1);
        await expectSeatsMatchBookings(pool);
        await expectRouteMatchesBookings(pool);
      }
    },
    RACE_TIMEOUT_MS,
  );
});

describe('one active booking per passenger (FR-P10, FR-C6)', () => {
  async function activeBookings(): Promise<number> {
    const { rows } = await pool.query(
      "SELECT 1 FROM bookings WHERE status NOT IN ('COMPLETED', 'CANCELLED')",
    );
    return rows.length;
  }

  it(
    'turns five taps of the same request into one booking (NFR-37)',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const responses = await Promise.all(
          Array.from({ length: 5 }, () => postJson(server, '/api/v1/bookings', tripFrom(), nusrat)),
        );

        const statuses = responses.map((res) => res.status).sort();
        expect(statuses).toEqual([200, 200, 200, 200, 201]);
        const ids = await Promise.all(
          responses.map(
            async (res) => ((await res.json()) as { booking: { id: string } }).booking.id,
          ),
        );
        expect(new Set(ids).size).toBe(1);
        expect(await activeBookings()).toBe(1);
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'refuses every other ride while one is active',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        // Five different rides, told apart by their destination.
        const responses = await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            postJson(
              server,
              '/api/v1/bookings',
              tripFrom(BANANI, { destination: { ...MOHAKHALI, label: `Mohakhali gate ${i + 1}` } }),
              nusrat,
            ),
          ),
        );

        const results = await Promise.all(responses.map(outcome));
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        for (const r of results.filter((x) => x.status !== 201)) {
          expect(r).toEqual({ status: 409, code: 'ACTIVE_BOOKING_EXISTS' });
        }
        expect(await activeBookings()).toBe(1);
      }
    },
    RACE_TIMEOUT_MS,
  );
});

async function cancelAsPassenger(passenger: string, bookingId: string) {
  return postJson(server, `/api/v1/bookings/${bookingId}/cancel`, {}, passenger);
}

async function fineCount(bookingId: string): Promise<number> {
  const entries = await entriesFor(pool, bookingId);
  return entries.filter((entry) => entry.type === 'fine').length;
}

// Every race below ends with the ledger matching every balance (phase 6 LLD §4), and
// the seats and the route matching the bookings.
async function expectInvariants(): Promise<void> {
  await expectLedgerConsistent(pool);
  await expectSeatsMatchBookings(pool);
  await expectRouteMatchesBookings(pool);
}

describe('money under races (FR-C7, NFR-37)', () => {
  it(
    'fines a double-tapped late cancel once',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const booking = await requestRide(server, nusrat, tripFrom(BANANI));
        expect((await acceptRequest(server, jashim, booking.id)).status).toBe(200);
        await ageAcceptance(pool, booking.id, '4 minutes');

        const results = await Promise.all(
          [1, 2].map(async () => outcome(await cancelAsPassenger(nusrat, booking.id))),
        );
        expect(results).toEqual([
          { status: 200, code: null },
          { status: 200, code: null },
        ]);
        expect(await fineCount(booking.id)).toBe(1);
        expect(await balanceOf(server, nusrat)).toBe('-30.00');
        await expectInvariants();
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'lets a passenger cancel and a no-show race, with at most one fine',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const booking = await requestRide(server, nusrat, tripFrom(BANANI));
        expect((await acceptRequest(server, jashim, booking.id)).status).toBe(200);
        expect((await driverAction(server, jashim, booking.id, 'arrive')).status).toBe(200);
        // Late for both: the cancel is fined, and the no-show is allowed.
        await ageAcceptance(pool, booking.id, '6 minutes');
        await ageArrival(pool, booking.id, '5 minutes 30 seconds');

        const [cancel, noShow] = await Promise.all([
          cancelAsPassenger(nusrat, booking.id).then(outcome),
          driverAction(server, jashim, booking.id, 'no-show').then(outcome),
        ]);

        // The cancel always answers 200: either it won, or the ride was already cancelled.
        // The no-show wins, or finds the ride cancelled by the passenger.
        expect(cancel).toEqual({ status: 200, code: null });
        expect([200, 409]).toContain(noShow.status);
        if (noShow.status === 409) expect(noShow.code).toBe('INVALID_TRANSITION');

        expect(await statusOf(booking.id)).toBe('CANCELLED');
        const { rows } = await pool.query(
          "SELECT reason FROM booking_status_history WHERE booking_id = $1 AND to_status = 'CANCELLED'",
          [booking.id],
        );
        expect(rows).toHaveLength(1);
        expect(await fineCount(booking.id)).toBe(1);
        expect(await balanceOf(server, nusrat)).toBe('-30.00');
        await expectInvariants();
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'pays once for a double-tapped TeslaPay complete',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        await topUp(server, nusrat, '100.00');
        const booking = await requestRide(
          server,
          nusrat,
          tripFrom(BANANI, { paymentMethod: 'teslapay' }),
        );
        expect((await acceptRequest(server, jashim, booking.id)).status).toBe(200);
        for (const action of ['arrive', 'start'] as const) {
          expect((await driverAction(server, jashim, booking.id, action)).status).toBe(200);
        }

        const results = await Promise.all(
          [1, 2].map(async () =>
            outcome(await driverAction(server, jashim, booking.id, 'complete')),
          ),
        );
        expect(results).toEqual([
          { status: 200, code: null },
          { status: 200, code: null },
        ]);
        expect((await entriesFor(pool, booking.id)).map((entry) => entry.type)).toEqual([
          'fare_payment',
          'driver_credit',
        ]);
        expect(await balanceOf(server, nusrat)).toBe('33.30');
        expect(await balanceOf(server, jashim)).toBe('66.70');
        await expectInvariants();
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'adds a top-up tapped ten times once',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const id = randomUUID();
        const statuses = await Promise.all(
          Array.from(
            { length: 10 },
            async () => (await postTopUp(server, nusrat, '25.00', id)).status,
          ),
        );
        expect(statuses.filter((status) => status === 201)).toHaveLength(1);
        expect(statuses.filter((status) => status === 200)).toHaveLength(9);
        expect(await balanceOf(server, nusrat)).toBe('25.00');
        await expectLedgerConsistent(pool);
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'adds ten different top-ups at once in full',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        const statuses = await Promise.all(
          Array.from(
            { length: 10 },
            async (_, i) => (await postTopUp(server, nusrat, `${i + 1}.00`)).status,
          ),
        );
        expect(statuses).toEqual(Array.from({ length: 10 }, () => 201));
        // 1 + 2 + … + 10.
        expect(await balanceOf(server, nusrat)).toBe('55.00');
        await expectLedgerConsistent(pool);
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "settles Nusrat's and Rafiq's TeslaPay rides alongside top-ups, without a deadlock",
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetRides(pool);
        await topUp(server, nusrat, '100.00');
        await topUp(server, rafiq, '100.00');
        const nusrats = await requestRide(
          server,
          nusrat,
          tripFrom(BANANI, { paymentMethod: 'teslapay' }),
        );
        expect((await acceptRequest(server, jashim, nusrats.id)).status).toBe(200);
        const rafiqs = await requestRide(
          server,
          rafiq,
          tripFrom(BANANI, { destination: GULSHAN_1, paymentMethod: 'teslapay' }),
        );
        expect((await acceptRequest(server, jashim, rafiqs.id)).status).toBe(200);
        for (const booking of [nusrats, rafiqs]) {
          for (const action of ['arrive', 'start'] as const) {
            expect((await driverAction(server, jashim, booking.id, action)).status).toBe(200);
          }
        }

        const results = await Promise.all([
          driverAction(server, jashim, nusrats.id, 'complete').then(outcome),
          driverAction(server, jashim, rafiqs.id, 'complete').then(outcome),
          postTopUp(server, nusrat, '10.00').then(outcome),
          postTopUp(server, rafiq, '10.00').then(outcome),
          postTopUp(server, nusrat, '5.00').then(outcome),
        ]);

        // Nusrat's drop-off comes first; Rafiq's complete either follows it or is told so.
        expect(results[0]).toEqual({ status: 200, code: null });
        expect(results.slice(2)).toEqual(
          Array.from({ length: 3 }, () => ({ status: 201, code: null })),
        );
        const rafiqComplete = results[1];
        if (rafiqComplete?.status !== 200) {
          expect(rafiqComplete).toEqual({ status: 409, code: 'OUT_OF_STOP_ORDER' });
        }
        expect(await balanceOf(server, nusrat)).toBe('62.98');
        await expectInvariants();
      }
    },
    RACE_TIMEOUT_MS,
  );
});
