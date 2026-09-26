import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import { haversineKm } from '../src/geo/haversine.js';
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
  acceptRequest,
  BANANI,
  driverAction,
  errorCode,
  GULSHAN_1,
  goOnlineAt,
  MOHAKHALI,
  requestRide,
  tripFrom,
  type BookingBody,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';

// Near Banani Road 11 but not on any stop, so the first leg is the drive to the pickup.
const START = { lat: 23.7921, lng: 90.4078 };

type Point = { lat: number; lng: number };
interface Leg {
  method: string;
  points: [number, number][];
  toStopId?: string;
}

let pool: pg.Pool;
let server: TestServer;
let ors: FakeOrs;
let driver: string;
let nusrat: string;
let rafiq: string;

const line = (from: Point, to: Point) => [
  [from.lat, from.lng],
  [to.lat, to.lng],
];

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL);
  ors = await startFakeOrs();
  server = await startTestServer(pool, {
    apiKey: 'test-key',
    baseUrl: ors.baseUrl,
    timeoutMs: 1_000,
  });
});

afterAll(async () => {
  await server.close();
  await ors.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  // Road distances like the fallback's, so the story's two rides pool as they do there.
  ors.behave({
    kind: 'distances',
    meters: ([fromLng, fromLat], [toLng, toLat]) =>
      haversineKm({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }) * 1300,
  });
  ors.directionsHits = 0;
  driver = await signUpAs(server, driverSignUp());
  nusrat = await signUpAs(server, passengerSignUp());
  rafiq = await signUpAs(
    server,
    passengerSignUp({ name: 'Rafiq', email: 'rafiq@example.com', gender: 'male' }),
  );
});

async function legsAt(path: string, cookie: string): Promise<Leg[]> {
  const res = await getJson(server, path, cookie);
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { legs: Leg[] }).legs;
}

async function stopIds(): Promise<Record<string, string>> {
  const res = await getJson(server, '/api/v1/driver/pool', driver);
  const { pool: trip } = (await res.json()) as {
    pool: { stops: Array<{ id: string; bookingId: string; type: string }> };
  };
  return Object.fromEntries(trip.stops.map((stop) => [`${stop.bookingId}:${stop.type}`, stop.id]));
}

async function step(booking: BookingBody, action: 'arrive' | 'start' | 'complete') {
  const res = await driverAction(server, driver, booking.id, action);
  if (res.status !== 200) throw new Error(`${action}: ${res.status} ${await res.text()}`);
}

describe('the road with a fare estimate (route-paths LLD §3)', () => {
  const estimate = () =>
    postJson(
      server,
      '/api/v1/fare-estimates',
      { pickup: BANANI, destination: MOHAKHALI, seats: 1, rideOption: 'pool' },
      nusrat,
    );

  it('carries the trip by road next to the price', async () => {
    const res = await estimate();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { estimatedFare: string; path: { legs: Leg[] } };

    expect(body.estimatedFare).toMatch(/^\d+\.\d{2}$/);
    expect(body.path).toEqual({ legs: [{ method: 'routed', points: line(BANANI, MOHAKHALI) }] });
  });

  it('still prices the trip when the road can’t be drawn', async () => {
    await estimate();
    await pool.query('TRUNCATE route_path_cache');
    ors.behave({ kind: 'status', status: 500 });

    const res = await estimate();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { distanceMethod: string; path: { legs: Leg[] } };
    // The distance was cached; the road falls back to a straight line.
    expect(body.distanceMethod).toBe('routed');
    expect(body.path.legs).toEqual([{ method: 'fallback', points: line(BANANI, MOHAKHALI) }]);
  });
});

describe('a passenger’s own road (FR-P8, FR-P9)', () => {
  it('is pickup to destination', async () => {
    const booking = await requestRide(server, nusrat, tripFrom(BANANI));

    expect(await legsAt(`/api/v1/bookings/${booking.id}/path`, nusrat)).toEqual([
      { method: 'routed', points: line(BANANI, MOHAKHALI) },
    ]);
  });

  it('stays their own ride once pooled, never the trip’s route', async () => {
    await goOnlineAt(server, driver, BANANI);
    const first = await requestRide(server, nusrat, tripFrom(BANANI));
    expect((await acceptRequest(server, driver, first.id)).status).toBe(200);
    const second = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    expect((await acceptRequest(server, driver, second.id)).status).toBe(200);

    expect(await legsAt(`/api/v1/bookings/${first.id}/path`, nusrat)).toEqual([
      { method: 'routed', points: line(BANANI, MOHAKHALI) },
    ]);
  });

  it('is not found for another passenger, and forbidden to a driver', async () => {
    const booking = await requestRide(server, nusrat, tripFrom(BANANI));

    const other = await getJson(server, `/api/v1/bookings/${booking.id}/path`, rafiq);
    expect(other.status).toBe(404);
    expect(await errorCode(other)).toBe('NOT_FOUND');
    const asDriver = await getJson(server, `/api/v1/bookings/${booking.id}/path`, driver);
    expect(asDriver.status).toBe(403);
  });
});

describe('a request’s road, for the driver to preview (NFR-9)', () => {
  it('is pickup to destination while the request is open', async () => {
    const booking = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));

    expect(await legsAt(`/api/v1/driver/requests/${booking.id}/path`, driver)).toEqual([
      { method: 'routed', points: line(BANANI, GULSHAN_1) },
    ]);
  });

  it('is not found once taken, and forbidden to a passenger', async () => {
    await goOnlineAt(server, driver, BANANI);
    const booking = await requestRide(server, nusrat, tripFrom(BANANI));
    expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);

    const taken = await getJson(server, `/api/v1/driver/requests/${booking.id}/path`, driver);
    expect(taken.status).toBe(404);
    const asPassenger = await getJson(server, `/api/v1/driver/requests/${booking.id}/path`, nusrat);
    expect(asPassenger.status).toBe(403);
  });
});

describe('the driver’s route still to come (FR-D14)', () => {
  const routePath = '/api/v1/driver/pool/path';

  it('is empty with no trip', async () => {
    await goOnlineAt(server, driver, START);
    expect(await legsAt(routePath, driver)).toEqual([]);
  });

  it('runs from the Tesla through each stop not reached, in order', async () => {
    await goOnlineAt(server, driver, START);
    const booking = await requestRide(server, nusrat, tripFrom(BANANI));
    expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);
    const ids = await stopIds();

    expect(await legsAt(routePath, driver)).toEqual([
      { method: 'routed', points: line(START, BANANI), toStopId: ids[`${booking.id}:pickup`] },
      { method: 'routed', points: line(BANANI, MOHAKHALI), toStopId: ids[`${booking.id}:dropoff`] },
    ]);
  });

  it('has no leg into a pickup the driver waits at, or into a stop reached', async () => {
    await goOnlineAt(server, driver, START);
    const booking = await requestRide(server, nusrat, tripFrom(BANANI));
    expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);
    const ids = await stopIds();
    const dropOffOnly = [
      { method: 'routed', points: line(BANANI, MOHAKHALI), toStopId: ids[`${booking.id}:dropoff`] },
    ];

    await step(booking, 'arrive');
    expect(await legsAt(routePath, driver)).toEqual(dropOffOnly);
    await step(booking, 'start');
    expect(await legsAt(routePath, driver)).toEqual(dropOffOnly);
    await step(booking, 'complete');
    expect(await legsAt(routePath, driver)).toEqual([]);
  });

  it('follows a pooled trip’s stops, leaving out a stop at the Tesla’s own point', async () => {
    await goOnlineAt(server, driver, BANANI);
    const first = await requestRide(server, nusrat, tripFrom(BANANI));
    expect((await acceptRequest(server, driver, first.id)).status).toBe(200);
    const second = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    expect((await acceptRequest(server, driver, second.id)).status).toBe(200);
    const ids = await stopIds();

    // Both pickups are where the Tesla stands, so the road starts at the first drop-off.
    expect(await legsAt(routePath, driver)).toEqual([
      { method: 'routed', points: line(BANANI, MOHAKHALI), toStopId: ids[`${first.id}:dropoff`] },
      {
        method: 'routed',
        points: line(MOHAKHALI, GULSHAN_1),
        toStopId: ids[`${second.id}:dropoff`],
      },
    ]);
  });

  it('asks the map service once for a layout, then reads it from the cache', async () => {
    await goOnlineAt(server, driver, START);
    const booking = await requestRide(server, nusrat, tripFrom(BANANI));
    expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);

    const before = ors.directionsHits;
    const first = await legsAt(routePath, driver);
    const asked = ors.directionsHits - before;
    expect(asked).toBeLessThanOrEqual(1);
    expect(await legsAt(routePath, driver)).toEqual(first);
    expect(ors.directionsHits - before).toBe(asked);
  });

  it('is forbidden to a passenger', async () => {
    expect((await getJson(server, routePath, nusrat)).status).toBe(403);
  });
});
