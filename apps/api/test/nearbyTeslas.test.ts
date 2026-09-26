import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import { blurPoint } from '../src/domain/dispatch.js';
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

// Near Banani Road 11 but not on any stop, so a move to a stop can't pass unnoticed.
const START = { lat: 23.7921, lng: 90.4078 };
// About 2.5 km north of Banani Road 11: outside the 2 km radius.
const FAR_NORTH = { lat: 23.8163, lng: 90.4066 };
// About 1.6 km south of Mohakhali, and about 3 km from Banani Road 11.
const SOUTH_OF_MOHAKHALI = { lat: 23.7672, lng: 90.409 };

type Point = { lat: number; lng: number };

let pool: pg.Pool;
let server: TestServer;
let driver: string;
let nusrat: string;
let rafiq: string;

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

function nearbyPath({ lat, lng }: Point): string {
  return `/api/v1/nearby-teslas?lat=${lat}&lng=${lng}`;
}

async function nearby(near: Point, passenger = nusrat) {
  const res = await getJson(server, nearbyPath(near), passenger);
  if (res.status !== 200) throw new Error(`nearby: ${res.status} ${await res.text()}`);
  return (await res.json()) as { radiusKm: number; teslas: Point[] };
}

async function teslasNear(near: Point, passenger = nusrat): Promise<Point[]> {
  return (await nearby(near, passenger)).teslas;
}

function blurred({ lat, lng }: Point): Point {
  return blurPoint({ lat, lng });
}

async function step(booking: BookingBody, action: 'arrive' | 'start' | 'complete') {
  const res = await driverAction(server, driver, booking.id, action);
  if (res.status !== 200) throw new Error(`${action}: ${res.status} ${await res.text()}`);
}

async function accepted(passenger: string, trip: unknown = tripFrom(BANANI)) {
  const booking = await requestRide(server, passenger, trip);
  expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);
  return booking;
}

describe('blurPoint', () => {
  it('rounds to 3 decimal places, about 110 m', () => {
    expect(blurPoint({ lat: 23.793749, lng: 90.406612 })).toEqual({ lat: 23.794, lng: 90.407 });
    expect(blurPoint({ lat: 23.7912, lng: 90.4004 })).toEqual({ lat: 23.791, lng: 90.4 });
  });
});

// Which Teslas a passenger sees near a pickup, and where (passenger nearby Teslas LLD §2).
describe('GET /nearby-teslas', () => {
  it('lists an online Tesla near the pickup, blurred and with nothing else', async () => {
    await goOnlineAt(server, driver, START);

    const body = await nearby(BANANI);
    expect(body).toEqual({ radiusKm: 2, teslas: [blurred(START)] });
    expect(Object.keys(body.teslas[0]!)).toEqual(['lat', 'lng']);
  });

  it('lists only the Teslas within the radius, in coordinate order', async () => {
    await goOnlineAt(server, driver, START);
    const second = await signUpAs(
      server,
      driverSignUp({
        name: 'Karim',
        email: 'karim@example.com',
        vehicle: { name: 'Arrow', capacity: 4 },
      }),
    );
    await goOnlineAt(server, second, BANANI);
    const third = await signUpAs(
      server,
      driverSignUp({
        name: 'Selim',
        email: 'selim@example.com',
        vehicle: { name: 'Comet', capacity: 4 },
      }),
    );
    await goOnlineAt(server, third, FAR_NORTH);

    expect(await teslasNear(BANANI)).toEqual([blurred(START), blurred(BANANI)]);
  });

  it('leaves out an offline Tesla', async () => {
    await goOnlineAt(server, driver, START);
    expect((await postJson(server, '/api/v1/driver/vehicle/offline', {}, driver)).status).toBe(200);

    expect(await teslasNear(BANANI)).toEqual([]);
  });

  it('leaves out a Tesla beyond the radius', async () => {
    await goOnlineAt(server, driver, FAR_NORTH);

    expect(await teslasNear(BANANI)).toEqual([]);
  });

  it('leaves out a full Tesla', async () => {
    await goOnlineAt(server, driver, START);
    await accepted(nusrat, tripFrom(BANANI, { seats: 3 }));

    expect(await teslasNear(BANANI, rafiq)).toEqual([]);
  });

  it('leaves out a Tesla on a solo ride, which has free seats but takes no one', async () => {
    await goOnlineAt(server, driver, START);
    await accepted(nusrat, tripFrom(BANANI, { rideOption: 'solo' }));

    expect(await teslasNear(BANANI, rafiq)).toEqual([]);
  });

  it('lists a Tesla on a same-gender trip to a passenger of the other gender', async () => {
    await goOnlineAt(server, driver, START);
    await accepted(nusrat, tripFrom(BANANI, { rideOption: 'same_gender' }));

    expect(await teslasNear(BANANI, rafiq)).toEqual([blurred(START)]);
  });
});

// A Tesla on a trip is where its route goes on from, not where it began (LLD §2).
describe('where a Tesla on a trip is shown', () => {
  it('is at its saved location once accepted, then at the pickup it waits at', async () => {
    await goOnlineAt(server, driver, START);
    const booking = await accepted(nusrat);

    expect(await teslasNear(BANANI, rafiq)).toEqual([blurred(START)]);
    await step(booking, 'arrive');
    expect(await teslasNear(BANANI, rafiq)).toEqual([blurred(BANANI)]);
  });

  it('is at the last drop-off reached, even beyond the radius from where it began', async () => {
    await goOnlineAt(server, driver, BANANI);
    const nusrats = await accepted(nusrat);
    const rafiqs = await accepted(rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    for (const booking of [nusrats, rafiqs]) {
      await step(booking, 'arrive');
      await step(booking, 'start');
    }
    const shirin = await signUpAs(
      server,
      passengerSignUp({ name: 'Shirin', email: 'shirin@example.com' }),
    );

    // Both aboard at Banani Road 11, about 3 km from here.
    expect(await teslasNear(SOUTH_OF_MOHAKHALI, shirin)).toEqual([]);
    // Nusrat's drop-off at Mohakhali comes first; Rafiq is still aboard.
    await step(nusrats, 'complete');
    expect(await teslasNear(SOUTH_OF_MOHAKHALI, shirin)).toEqual([blurred(MOHAKHALI)]);
  });
});

describe('who may look (NFR-8, NFR-10)', () => {
  it('refuses a driver', async () => {
    const res = await getJson(server, nearbyPath(BANANI), driver);
    expect(res.status).toBe(403);
  });

  it('refuses someone signed out', async () => {
    const res = await getJson(server, nearbyPath(BANANI));
    expect(res.status).toBe(401);
  });

  it.each([
    ['a missing lat', `/api/v1/nearby-teslas?lng=${BANANI.lng}`],
    ['an empty lat', `/api/v1/nearby-teslas?lat=&lng=${BANANI.lng}`],
    ['a lat that is not a number', `/api/v1/nearby-teslas?lat=north&lng=${BANANI.lng}`],
    ['a point outside Dhaka', `/api/v1/nearby-teslas?lat=23.2&lng=${BANANI.lng}`],
  ])('refuses %s', async (_case, path) => {
    const res = await getJson(server, path, nusrat);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_ERROR');
  });
});
