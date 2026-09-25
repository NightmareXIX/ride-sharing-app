import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../src/db/client.js';
import { checkAccept, commitAccept } from '../src/services/pools.js';
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
  acceptRequest,
  driverAction,
  errorCode,
  expectSeatsMatchBookings,
  goOnlineAt,
  nearbyRequestIds,
  requestRide,
  seatsTaken,
  tripFrom,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';

const DISPATCH = { searchRadiusKm: 2 };

let pool: pg.Pool;
let db: Database;
let server: TestServer;
let driver: string;
let nusrat: string;
let rafiq: string;
let shirin: string;

interface TripBody {
  pool: { id: string; seats: { capacity: number; taken: number } } | null;
}

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL);
  db = createDb(pool);
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
  await goOnlineAt(server, driver);
});

async function statusOf(bookingId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>(
    'SELECT status FROM bookings WHERE id = $1',
    [bookingId],
  );
  return rows[0]?.status;
}

async function jashimId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE email = 'jashim@example.com'",
  );
  if (!rows[0]) throw new Error('Jashim is missing');
  return rows[0].id;
}

// Rafiq takes 2 of Bullet's 3 seats, leaving the last one.
async function rafiqAboardWithTwoSeats() {
  const booking = await requestRide(server, rafiq, tripFrom(BANANI, { seats: 2 }));
  expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);
  return booking;
}

describe("Bullet's seat limit (FR-R2, FR-C1)", () => {
  it('fills the same trip seat by seat, then refuses the next rider', async () => {
    const rafiqs = await rafiqAboardWithTwoSeats();
    expect(await seatsTaken(pool)).toBe(2);

    const nusrats = await requestRide(server, nusrat);
    const res = await acceptRequest(server, driver, nusrats.id);
    const trip = (await res.json()) as TripBody;
    expect(trip.pool?.seats).toEqual({ capacity: 3, taken: 3 });

    // Bullet is full: Shirin's request isn't listed, and accepting it anyway is refused.
    const shirins = await requestRide(server, shirin, tripFrom(GULSHAN_1));
    expect(await nearbyRequestIds(server, driver)).toEqual([]);
    const refused = await acceptRequest(server, driver, shirins.id);
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe('SEATS_UNAVAILABLE');

    expect(await statusOf(shirins.id)).toBe('REQUESTED');
    expect(await statusOf(rafiqs.id)).toBe('ACCEPTED');
    expect(await seatsTaken(pool)).toBe(3);
    await expectSeatsMatchBookings(pool);
  });

  it('lists only requests that fit the free seats', async () => {
    await rafiqAboardWithTwoSeats();
    const two = await requestRide(server, nusrat, tripFrom(BANANI, { seats: 2 }));
    const one = await requestRide(server, shirin, tripFrom(GULSHAN_1));

    expect(await nearbyRequestIds(server, driver)).toEqual([one.id]);
    const refused = await acceptRequest(server, driver, two.id);
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe('SEATS_UNAVAILABLE');
  });

  it('takes a new rider after the trip has started (FR-D9)', async () => {
    const rafiqs = await rafiqAboardWithTwoSeats();
    await driverAction(server, driver, rafiqs.id, 'arrive');
    await driverAction(server, driver, rafiqs.id, 'start');

    const nusrats = await requestRide(server, nusrat);
    expect((await acceptRequest(server, driver, nusrats.id)).status).toBe(200);
    expect(await seatsTaken(pool)).toBe(3);
  });

  it('shows the seats taken on the Tesla', async () => {
    await rafiqAboardWithTwoSeats();
    const res = await getJson(server, '/api/v1/driver/vehicle', driver);
    expect(((await res.json()) as { vehicle: unknown }).vehicle).toMatchObject({
      capacity: 3,
      occupiedSeats: 2,
    });
  });

  it('is enforced by the database too', async () => {
    const overfill = pool.query("UPDATE vehicles SET occupied_seats = 4 WHERE name = 'Bullet'");
    await expect(overfill).rejects.toMatchObject({
      code: '23514',
      constraint: 'vehicles_occupied_seats_range',
    });
    const negative = pool.query("UPDATE vehicles SET occupied_seats = -1 WHERE name = 'Bullet'");
    await expect(negative).rejects.toMatchObject({ code: '23514' });
  });
});

describe('freeing seats', () => {
  it('frees them when a passenger is dropped off', async () => {
    const rafiqs = await rafiqAboardWithTwoSeats();
    const nusrats = await requestRide(server, nusrat);
    await acceptRequest(server, driver, nusrats.id);
    for (const action of ['arrive', 'start', 'complete'] as const) {
      expect((await driverAction(server, driver, nusrats.id, action)).status).toBe(200);
    }

    expect(await seatsTaken(pool)).toBe(2);
    const shirins = await requestRide(server, shirin, tripFrom(GULSHAN_1));
    expect(await nearbyRequestIds(server, driver)).toEqual([shirins.id]);

    // A repeated complete frees nothing more.
    expect((await driverAction(server, driver, nusrats.id, 'complete')).status).toBe(200);
    expect(await seatsTaken(pool)).toBe(2);
    expect(await statusOf(rafiqs.id)).toBe('ACCEPTED');
    await expectSeatsMatchBookings(pool);
  });

  it('frees them when the driver hands a ride back, and lists it again', async () => {
    const rafiqs = await rafiqAboardWithTwoSeats();

    expect((await driverAction(server, driver, rafiqs.id, 'cancel')).status).toBe(200);
    expect(await seatsTaken(pool)).toBe(0);
    expect(await nearbyRequestIds(server, driver)).toEqual([rafiqs.id]);

    expect((await driverAction(server, driver, rafiqs.id, 'cancel')).status).toBe(200);
    expect(await seatsTaken(pool)).toBe(0);
  });

  it('frees them when a passenger cancels after acceptance', async () => {
    const rafiqs = await rafiqAboardWithTwoSeats();
    const nusrats = await requestRide(server, nusrat);
    await acceptRequest(server, driver, nusrats.id);
    await driverAction(server, driver, nusrats.id, 'arrive');

    // From ACCEPTED.
    await postJson(server, `/api/v1/bookings/${rafiqs.id}/cancel`, {}, rafiq);
    expect(await seatsTaken(pool)).toBe(1);
    // From DRIVER_ARRIVED; the trip is now empty.
    await postJson(server, `/api/v1/bookings/${nusrats.id}/cancel`, {}, nusrat);
    expect(await seatsTaken(pool)).toBe(0);

    // Cancelling again frees nothing more.
    expect(
      (await postJson(server, `/api/v1/bookings/${nusrats.id}/cancel`, {}, nusrat)).status,
    ).toBe(200);
    expect(await seatsTaken(pool)).toBe(0);
    const trip = (await (await getJson(server, '/api/v1/driver/pool', driver)).json()) as TripBody;
    expect(trip.pool).toBeNull();
    await expectSeatsMatchBookings(pool);
  });

  it('frees none when a waiting request is cancelled', async () => {
    await rafiqAboardWithTwoSeats();
    const nusrats = await requestRide(server, nusrat);
    await postJson(server, `/api/v1/bookings/${nusrats.id}/cancel`, {}, nusrat);
    expect(await seatsTaken(pool)).toBe(2);
  });
});

describe('accepting from an out-of-date view (FR-C3)', () => {
  it('refuses when the Tesla changed after the check', async () => {
    const nusrats = await requestRide(server, nusrat);
    const snapshot = await checkAccept(db, await jashimId(), nusrats.id, DISPATCH);
    if (!snapshot) throw new Error('Expected a fresh accept');

    // Setting the same location again still counts as a change.
    await sendJson(
      server,
      'PUT',
      '/api/v1/driver/vehicle/location',
      { lat: BANANI.lat, lng: BANANI.lng },
      driver,
    );

    await expect(commitAccept(db, await jashimId(), snapshot, DISPATCH)).rejects.toMatchObject({
      status: 409,
      code: 'POOL_CHANGED',
    });
    expect(await statusOf(nusrats.id)).toBe('REQUESTED');
    expect(await seatsTaken(pool)).toBe(0);
    const { rows } = await pool.query('SELECT id FROM pools');
    expect(rows).toHaveLength(0);
  });

  it('says the seat is gone when another accept took it first', async () => {
    await rafiqAboardWithTwoSeats();
    const nusrats = await requestRide(server, nusrat);
    const shirins = await requestRide(server, shirin, tripFrom(GULSHAN_1));

    // Both see one seat left (PRD §14); Shirin's accept commits first.
    const snapshot = await checkAccept(db, await jashimId(), nusrats.id, DISPATCH);
    if (!snapshot) throw new Error('Expected a fresh accept');
    expect((await acceptRequest(server, driver, shirins.id)).status).toBe(200);

    await expect(commitAccept(db, await jashimId(), snapshot, DISPATCH)).rejects.toMatchObject({
      status: 409,
      code: 'SEATS_UNAVAILABLE',
    });
    expect(await statusOf(nusrats.id)).toBe('REQUESTED');
    expect(await seatsTaken(pool)).toBe(3);
  });
});

describe('privacy in a shared Tesla (FR-P8, NFR-9)', () => {
  it("shows each passenger only their own ride, never the co-passenger's", async () => {
    const rafiqs = await rafiqAboardWithTwoSeats();
    const nusrats = await requestRide(server, nusrat, tripFrom(BANANI, { seats: 1 }));
    await acceptRequest(server, driver, nusrats.id);
    expect(rafiqs.estimatedFare).not.toBe(nusrats.estimatedFare);

    const hers = JSON.stringify(
      await (await getJson(server, '/api/v1/bookings/current', nusrat)).json(),
    );
    const his = JSON.stringify(
      await (await getJson(server, '/api/v1/bookings/current', rafiq)).json(),
    );
    expect(hers).toContain('Jashim');
    expect(hers).not.toContain('Rafiq');
    expect(his).not.toContain('Nusrat');
    expect(hers).not.toContain(`"${String(rafiqs.estimatedFare)}"`);
  });
});
