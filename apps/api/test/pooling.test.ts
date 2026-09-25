import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../src/db/client.js';
import { createDistanceService } from '../src/geo/distance.js';
import { fallbackRoadKm } from '../src/geo/haversine.js';
import { checkAccept, commitAccept, type TripDeps } from '../src/services/pools.js';
import {
  driverSignUp,
  getJson,
  passengerSignUp,
  postJson,
  resetDb,
  signUpAs,
} from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import { startFakeOrs, type FakeOrs } from './support/fakeOrs.js';
import {
  BANANI,
  GULSHAN_1,
  MOHAKHALI,
  UTTARA,
  acceptRequest,
  driverAction,
  errorCode,
  expectRouteMatchesBookings,
  expectSeatsMatchBookings,
  goOnlineAt,
  requestRide,
  tripFrom,
  type BookingBody,
} from './support/rides.js';
import { NO_ROUTING, startTestServer, type TestServer } from './support/server.js';

const MIRPUR = { lat: 23.8069, lng: 90.3687, label: 'Mirpur 10' };

let pool: pg.Pool;
let db: Database;
let server: TestServer;
let driver: string;
let nusrat: string;
let rafiq: string;
let shirin: string;

interface Stop {
  bookingId: string;
  passenger: { name: string };
  type: 'pickup' | 'dropoff';
  plannedOdometerKm: string;
  actualOdometerKm: string | null;
  isNext: boolean;
}

interface Trip {
  odometerKm: string;
  stops: Stop[];
  bookings: Array<{ id: string; nextAction: string; canAct: boolean }>;
}

interface Fare {
  pickupOdometerKm: string;
  dropoffOdometerKm: string;
  actualKm: string;
  sharedKm: string;
  directKm: string;
  estimatedFare: string;
  computedFare: string;
  finalFare: string;
  routeDistanceMethod: string;
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
  await goOnlineAt(server, driver, BANANI);
});

async function trip(): Promise<Trip> {
  const body = (await (await getJson(server, '/api/v1/driver/pool', driver)).json()) as {
    pool: Trip;
  };
  return body.pool;
}

function route(t: Trip): string[] {
  return t.stops.map((s) => `${s.passenger.name} ${s.type} ${s.plannedOdometerKm}`);
}

async function step(booking: BookingBody, action: 'arrive' | 'start' | 'complete' | 'cancel') {
  const res = await driverAction(server, driver, booking.id, action);
  if (res.status !== 200) throw new Error(`${action}: ${res.status} ${await res.text()}`);
  return res;
}

// The story (phase 5 LLD §7): Nusrat to Mohakhali, then Rafiq to Gulshan 1, both from
// Banani Road 11, where Bullet waits. Distances use the fallback, as with no map key.
async function nusratThenRafiq() {
  const nusrats = await requestRide(server, nusrat, tripFrom(BANANI));
  expect((await acceptRequest(server, driver, nusrats.id)).status).toBe(200);
  const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
  return { nusrats, rafiqs };
}

describe("Nusrat and Rafiq's shared trip (FR-L4, NFR-27)", () => {
  it('lists Rafiq on the route, with the km he adds', async () => {
    const { rafiqs } = await nusratThenRafiq();
    expect([rafiqs.directKm, rafiqs.estimatedFare]).toEqual(['2.287', '75.74']);

    const body = (await (await getJson(server, '/api/v1/driver/requests', driver)).json()) as {
      requests: Array<{ id: string; addedKm: string | null }>;
    };
    expect(body.requests).toEqual([expect.objectContaining({ id: rafiqs.id, addedKm: '0.970' })]);
  });

  it('plans both pickups, then drops Nusrat on the way to Gulshan 1', async () => {
    const { rafiqs } = await nusratThenRafiq();
    expect((await acceptRequest(server, driver, rafiqs.id)).status).toBe(200);

    const t = await trip();
    expect(route(t)).toEqual([
      'Nusrat pickup 0.000',
      'Rafiq pickup 0.000',
      'Nusrat dropoff 1.835',
      'Rafiq dropoff 2.805',
    ]);
    expect(t.stops.map((s) => s.isNext)).toEqual([true, false, false, false]);
    expect(t.bookings.map((b) => b.canAct)).toEqual([true, false]);
    await expectRouteMatchesBookings(pool);
  });

  it('prices both rides so they check by hand', async () => {
    const { nusrats, rafiqs } = await nusratThenRafiq();
    await acceptRequest(server, driver, rafiqs.id);
    await step(nusrats, 'arrive');
    await step(nusrats, 'start');
    await step(rafiqs, 'arrive');
    await step(rafiqs, 'start');
    const hers = ((await (await step(nusrats, 'complete')).json()) as { fare: Fare }).fare;
    const his = ((await (await step(rafiqs, 'complete')).json()) as { fare: Fare }).fare;

    // Nusrat: 30 + 20 × 1.835 − 8 × 1.835 = 52.02, under her 66.70 estimate.
    expect(hers).toMatchObject({
      pickupOdometerKm: '0.000',
      dropoffOdometerKm: '1.835',
      actualKm: '1.835',
      sharedKm: '1.835',
      directKm: '1.835',
      estimatedFare: '66.70',
      computedFare: '52.02',
      finalFare: '52.02',
      routeDistanceMethod: 'fallback',
    });
    // Rafiq: 30 + 20 × 2.805 − 8 × 1.835 = 71.42, under his 75.74 estimate.
    expect(his).toMatchObject({
      pickupOdometerKm: '0.000',
      dropoffOdometerKm: '2.805',
      actualKm: '2.805',
      sharedKm: '1.835',
      directKm: '2.287',
      estimatedFare: '75.74',
      computedFare: '71.42',
      finalFare: '71.42',
    });
    expect(await trip()).toBeNull();
  });

  it("shows each passenger their own fare, never the other's (FR-P8, NFR-9)", async () => {
    const { nusrats, rafiqs } = await nusratThenRafiq();
    await acceptRequest(server, driver, rafiqs.id);

    const hers = JSON.stringify(
      await (await getJson(server, `/api/v1/bookings/${nusrats.id}`, nusrat)).json(),
    );
    expect(hers).not.toContain('Rafiq');
    expect(hers).not.toContain(rafiqs.id);
    expect(hers).not.toContain('75.74');
  });
});

describe('the matching rule for a Tesla with passengers (FR-D7, FR-L3)', () => {
  it('hides a request off the route, and refuses to accept it', async () => {
    await nusratThenRafiq();
    const shirins = await requestRide(server, shirin, tripFrom(UTTARA, { destination: MIRPUR }));

    const body = (await (await getJson(server, '/api/v1/driver/requests', driver)).json()) as {
      requests: Array<{ id: string }>;
    };
    expect(body.requests.map((r) => r.id)).not.toContain(shirins.id);
    const res = await acceptRequest(server, driver, shirins.id);
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('NO_LONGER_MATCHES');
    expect(route(await trip())).toEqual(['Nusrat pickup 0.000', 'Nusrat dropoff 1.835']);
  });

  it('fits a ride that starts where one ends, once a passenger is aboard', async () => {
    const { nusrats } = await nusratThenRafiq();
    await step(nusrats, 'arrive');
    await step(nusrats, 'start');
    const shirins = await requestRide(
      server,
      shirin,
      tripFrom(MOHAKHALI, { destination: GULSHAN_1 }),
    );

    // Shirin boards at Mohakhali as Nusrat gets off, so nobody rides further.
    expect((await acceptRequest(server, driver, shirins.id)).status).toBe(200);
    expect(route(await trip())).toEqual([
      'Nusrat pickup 0.000',
      'Shirin pickup 1.835',
      'Nusrat dropoff 1.835',
      'Shirin dropoff 2.805',
    ]);
    await expectRouteMatchesBookings(pool);
  });
});

describe('stop order (API Routes §8)', () => {
  it('refuses a step away from the next stop, naming the next stop', async () => {
    const { nusrats, rafiqs } = await nusratThenRafiq();
    await acceptRequest(server, driver, rafiqs.id);

    const early = await driverAction(server, driver, rafiqs.id, 'arrive');
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({
      error: { code: 'OUT_OF_STOP_ORDER', message: 'Pick up Nusrat at Banani Road 11 first.' },
    });

    await step(nusrats, 'arrive');
    await step(nusrats, 'start');
    await step(rafiqs, 'arrive');
    await step(rafiqs, 'start');
    const wrongDropOff = await driverAction(server, driver, rafiqs.id, 'complete');
    expect(wrongDropOff.status).toBe(409);
    expect(await errorCode(wrongDropOff)).toBe('OUT_OF_STOP_ORDER');
    const { rows } = await pool.query('SELECT status FROM bookings WHERE id = $1', [rafiqs.id]);
    expect(rows[0]?.status).toBe('STARTED');
  });

  it('answers a repeated step with the trip, as before', async () => {
    const { nusrats } = await nusratThenRafiq();
    await step(nusrats, 'arrive');
    await step(nusrats, 'arrive');
    await step(nusrats, 'start');
    expect((await driverAction(server, driver, nusrats.id, 'start')).status).toBe(200);
  });
});

describe('odometer readings (FR-L5, NFR-41)', () => {
  it('records the planned km on pickup and drop-off, then never changes it', async () => {
    const { nusrats } = await nusratThenRafiq();
    await step(nusrats, 'arrive');
    let t = await trip();
    expect(t.stops.map((s) => s.actualOdometerKm)).toEqual([null, null]);

    await step(nusrats, 'start');
    t = await trip();
    expect(t.stops.map((s) => s.actualOdometerKm)).toEqual(['0.000', null]);
    expect(t.odometerKm).toBe('0.000');

    const update = pool.query(
      'UPDATE route_stops SET planned_odometer_km = 9 WHERE reached_at IS NOT NULL',
    );
    await expect(update).rejects.toMatchObject({ code: '23001' });
    const remove = pool.query('DELETE FROM route_stops WHERE reached_at IS NOT NULL');
    await expect(remove).rejects.toMatchObject({ code: '23001' });
    // A stop still ahead may be re-planned, but its reading is always the planned km.
    const fake = pool.query(
      'UPDATE route_stops SET actual_odometer_km = 5, reached_at = now() WHERE reached_at IS NULL',
    );
    await expect(fake).rejects.toMatchObject({ code: '23514' });
  });
});

describe('re-planning when a passenger leaves (Core Entities §3)', () => {
  // Rafiq first, then Nusrat, whose drop-off lies on his way: his ride is 0.518 km longer.
  async function rafiqThenNusrat() {
    const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    await acceptRequest(server, driver, rafiqs.id);
    const nusrats = await requestRide(server, nusrat, tripFrom(BANANI));
    await acceptRequest(server, driver, nusrats.id);
    await step(rafiqs, 'arrive');
    await step(rafiqs, 'start');
    return { rafiqs, nusrats };
  }

  async function version(): Promise<number> {
    const { rows } = await pool.query<{ version: number }>('SELECT version FROM vehicles');
    return rows[0]?.version ?? -1;
  }

  it.each([
    ['the passenger cancels', 'passenger'],
    ['the driver hands the ride back', 'driver'],
  ] as const)('drops the stops and shortens the route when %s', async (_name, who) => {
    const { nusrats } = await rafiqThenNusrat();
    expect(route(await trip())).toEqual([
      'Rafiq pickup 0.000',
      'Nusrat pickup 0.000',
      'Nusrat dropoff 1.835',
      'Rafiq dropoff 2.805',
    ]);
    const before = await version();

    const res =
      who === 'passenger'
        ? await postJson(server, `/api/v1/bookings/${nusrats.id}/cancel`, {}, nusrat)
        : await driverAction(server, driver, nusrats.id, 'cancel');
    expect(res.status).toBe(200);

    const t = await trip();
    expect(route(t)).toEqual(['Rafiq pickup 0.000', 'Rafiq dropoff 2.287']);
    expect(t.stops[0]?.actualOdometerKm).toBe('0.000');
    expect(await version()).toBeGreaterThan(before);
    await expectRouteMatchesBookings(pool);
    await expectSeatsMatchBookings(pool);
  });
});

describe('an accept planned against an older route (FR-C3)', () => {
  it('is refused when the driver moves on in between', async () => {
    const deps: TripDeps = { db, distance: createDistanceService(db, NO_ROUTING) };
    const log = pino({ level: 'silent' });
    const dispatch = { searchRadiusKm: 2 };
    const { nusrats, rafiqs } = await nusratThenRafiq();
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'jashim@example.com'",
    );
    const jashimId = rows[0]?.id ?? '';

    const snapshot = await checkAccept(deps, log, jashimId, rafiqs.id, dispatch);
    if (!snapshot) throw new Error('Expected a fresh accept');
    await step(nusrats, 'arrive');

    await expect(commitAccept(db, jashimId, snapshot, dispatch)).rejects.toMatchObject({
      status: 409,
      code: 'POOL_CHANGED',
    });
    expect(route(await trip())).toEqual(['Nusrat pickup 0.000', 'Nusrat dropoff 1.835']);
  });
});

describe('route checks per refresh (NFR-3)', () => {
  let ors: FakeOrs;
  let routed: TestServer;
  // The fake map service answers with the fallback's distances, so the story still pools.
  const roadMeters = ([fromLng, fromLat]: number[], [toLng, toLat]: number[]) =>
    Number(
      fallbackRoadKm(
        { lat: fromLat ?? 0, lng: fromLng ?? 0 },
        { lat: toLat ?? 0, lng: toLng ?? 0 },
      ),
    ) * 1000;

  beforeAll(async () => {
    ors = await startFakeOrs();
    routed = await startTestServer(pool, {
      apiKey: 'test-key',
      baseUrl: ors.baseUrl,
      timeoutMs: 1_000,
    });
  });

  afterAll(async () => {
    await routed.close();
    await ors.close();
  });

  async function listed(): Promise<string[]> {
    const res = await getJson(routed, '/api/v1/driver/requests', driver);
    return ((await res.json()) as { requests: Array<{ id: string }> }).requests.map((r) => r.id);
  }

  it('asks the map service about at most 3 new requests, then the rest', async () => {
    ors.behave({ kind: 'distances', meters: roadMeters });
    const nusrats = await requestRide(routed, nusrat, tripFrom(BANANI));
    expect((await acceptRequest(routed, driver, nusrats.id)).status).toBe(200);

    // Five more riders along Nusrat's way, each from a slightly different corner.
    const riders: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const cookie = await signUpAs(
        routed,
        passengerSignUp({ name: `Rider ${i + 1}`, email: `rider${i + 1}@example.com` }),
      );
      const pickup = { ...BANANI, lat: BANANI.lat - 0.0005 * (i + 1), label: `Banani ${i + 1}` };
      riders.push((await requestRide(routed, cookie, tripFrom(pickup))).id);
    }

    ors.matrixHits = 0;
    const first = await listed();
    expect(ors.matrixHits).toBe(3);
    expect(first).toEqual(riders.slice(0, 3));

    ors.matrixHits = 0;
    expect(await listed()).toEqual(riders);
    expect(ors.matrixHits).toBe(2);

    ors.matrixHits = 0;
    expect(await listed()).toEqual(riders);
    expect(ors.matrixHits).toBe(0);
  });

  it('checks every request at once when no map key is set', async () => {
    const nusrats = await requestRide(server, nusrat, tripFrom(BANANI));
    await acceptRequest(server, driver, nusrats.id);
    const riders: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const cookie = await signUpAs(
        server,
        passengerSignUp({ name: `Rider ${i + 1}`, email: `rider${i + 1}@example.com` }),
      );
      const pickup = { ...BANANI, lat: BANANI.lat - 0.0005 * (i + 1), label: `Banani ${i + 1}` };
      riders.push((await requestRide(server, cookie, tripFrom(pickup))).id);
    }

    const res = await getJson(server, '/api/v1/driver/requests', driver);
    const ids = ((await res.json()) as { requests: Array<{ id: string }> }).requests.map(
      (r) => r.id,
    );
    expect(ids).toEqual(riders);
  });
});
