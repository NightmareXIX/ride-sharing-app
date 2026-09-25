import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import { fallbackRoadKm } from '../src/geo/haversine.js';
import { driverSignUp, getJson, passengerSignUp, resetDb, signUpAs } from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import { startFakeOrs, type FakeOrs } from './support/fakeOrs.js';
import {
  BANANI,
  GULSHAN_1,
  acceptRequest,
  driverAction,
  expectRideOptionsHeld,
  expectRouteMatchesBookings,
  expectSeatsMatchBookings,
  goOnlineAt,
  nearbyRequestIds,
  requestRide,
  seatsTaken,
  tripFrom,
  type BookingBody,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';

let pool: pg.Pool;
let server: TestServer;
let driver: string;
let nusrat: string;
let rafiq: string;
let shirin: string;

interface Trip {
  joinRule: string;
  bookings: Array<{ id: string; nextAction: 'arrive' | 'start' | 'complete'; canAct: boolean }>;
}

interface Fare {
  actualKm: string;
  sharedKm: string;
  optionMultiplier: string;
  estimatedFare: string;
  computedFare: string;
  finalFare: string;
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

async function trip(): Promise<Trip | null> {
  const res = await getJson(server, '/api/v1/driver/pool', driver);
  return ((await res.json()) as { pool: Trip | null }).pool;
}

async function accepted(booking: BookingBody): Promise<void> {
  const res = await acceptRequest(server, driver, booking.id);
  if (res.status !== 200) throw new Error(`accept: ${res.status} ${await res.text()}`);
}

// The refusal an accept got, with its message.
async function refusal(booking: BookingBody): Promise<{ status: number; message: string }> {
  const res = await acceptRequest(server, driver, booking.id);
  const body = (await res.json()) as { error?: { code: string; message: string } };
  expect(body.error?.code).toBe('NO_LONGER_MATCHES');
  return { status: res.status, message: body.error?.message ?? '' };
}

async function teslaVersion(): Promise<number> {
  const { rows } = await pool.query<{ version: number }>(
    "SELECT version FROM vehicles WHERE name = 'Bullet'",
  );
  return rows[0]?.version ?? -1;
}

async function statusOf(booking: BookingBody): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>(
    'SELECT status FROM bookings WHERE id = $1',
    [booking.id],
  );
  return rows[0]?.status;
}

// Takes whichever step the route allows next until everyone is dropped off, and returns
// each passenger's fare by booking id.
async function driveEveryoneHome(): Promise<Map<string, Fare>> {
  const fares = new Map<string, Fare>();
  for (let current = await trip(); current; current = await trip()) {
    const next = current.bookings.find((b) => b.canAct);
    if (!next) throw new Error('Nobody can take a step');
    const res = await driverAction(server, driver, next.id, next.nextAction);
    if (res.status !== 200) throw new Error(`${next.nextAction}: ${res.status}`);
    if (next.nextAction === 'complete') {
      fares.set(next.id, ((await res.json()) as { fare: Fare }).fare);
    }
  }
  return fares;
}

describe('an idle Tesla (FR-D6)', () => {
  it('sees Solo and Same-gender requests, with no one’s gender', async () => {
    const nusrats = await requestRide(
      server,
      nusrat,
      tripFrom(BANANI, { rideOption: 'same_gender' }),
    );
    const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { rideOption: 'solo' }));

    const res = await getJson(server, '/api/v1/driver/requests', driver);
    const { requests } = (await res.json()) as { requests: Array<Record<string, unknown>> };
    expect(requests.map((r) => r.id)).toEqual([nusrats.id, rafiqs.id]);
    // The filter reads genders; the list never shows them (NFR-9).
    for (const request of requests) {
      expect(Object.values(request)).not.toContain('female');
      expect(request).not.toHaveProperty('gender');
    }
  });
});

describe('a solo ride (FR-R10, FR-D7)', () => {
  it('locks the Tesla: nothing is listed, and nothing can be accepted', async () => {
    const rafiqs = await requestRide(
      server,
      rafiq,
      tripFrom(BANANI, { destination: GULSHAN_1, rideOption: 'solo' }),
    );
    await accepted(rafiqs);
    const nusrats = await requestRide(server, nusrat, tripFrom(BANANI));

    expect((await trip())?.joinRule).toBe('no_one');
    expect(await nearbyRequestIds(server, driver)).toEqual([]);
    const version = await teslaVersion();
    expect(await refusal(nusrats)).toEqual({
      status: 422,
      message: 'Your Tesla is on a solo ride.',
    });
    expect(await statusOf(nusrats)).toBe('REQUESTED');
    expect(await seatsTaken(pool)).toBe(1);
    expect(await teslaVersion()).toBe(version);
  });

  it('answers a repeated accept of the solo ride itself with the trip (FR-C5)', async () => {
    const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { rideOption: 'solo' }));
    await accepted(rafiqs);
    expect((await acceptRequest(server, driver, rafiqs.id)).status).toBe(200);
    expect(await seatsTaken(pool)).toBe(1);
  });

  it('prices Rafiq’s ride alone at its estimate, 87.10 (FR-F2, §7)', async () => {
    const rafiqs = await requestRide(
      server,
      rafiq,
      tripFrom(BANANI, { destination: GULSHAN_1, rideOption: 'solo' }),
    );
    // (30 + 20 × 2.287) × 1.15 = 87.101
    expect(rafiqs.estimatedFare).toBe('87.10');
    await accepted(rafiqs);

    const fares = await driveEveryoneHome();
    expect(fares.get(rafiqs.id)).toMatchObject({
      actualKm: '2.287',
      sharedKm: '0.000',
      optionMultiplier: '1.15',
      estimatedFare: '87.10',
      computedFare: '87.10',
      finalFare: '87.10',
    });
  });

  it('needs an empty Tesla: a Solo request is neither listed nor accepted beside a rider', async () => {
    const nusrats = await requestRide(server, nusrat, tripFrom(BANANI));
    await accepted(nusrats);
    const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { rideOption: 'solo' }));

    expect((await trip())?.joinRule).toBe('anyone');
    expect(await nearbyRequestIds(server, driver)).toEqual([]);
    const version = await teslaVersion();
    expect(await refusal(rafiqs)).toEqual({
      status: 422,
      message: 'Solo rides need an empty Tesla.',
    });
    expect(await statusOf(rafiqs)).toBe('REQUESTED');
    expect(await seatsTaken(pool)).toBe(1);
    expect(await teslaVersion()).toBe(version);
    await expectRouteMatchesBookings(pool);
  });
});

describe('a same-gender pool (FR-R10, FR-D7)', () => {
  it('takes Shirin beside Nusrat and keeps Rafiq out until they are dropped off (§7)', async () => {
    const nusrats = await requestRide(
      server,
      nusrat,
      tripFrom(BANANI, { rideOption: 'same_gender' }),
    );
    // (30 + 20 × 1.835) × 1.05 = 70.035
    expect(nusrats.estimatedFare).toBe('70.04');
    await accepted(nusrats);
    expect((await trip())?.joinRule).toBe('women');

    const shirins = await requestRide(
      server,
      shirin,
      tripFrom(BANANI, { rideOption: 'same_gender' }),
    );
    const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    expect(await nearbyRequestIds(server, driver)).toEqual([shirins.id]);
    expect(await refusal(rafiqs)).toEqual({
      status: 422,
      message: "This request can't share with the passengers in your Tesla.",
    });
    await accepted(shirins);
    await expectRideOptionsHeld(pool);

    // Both ride the whole 1.835 km together: (30 + 36.70 − 14.68) × 1.05 = 54.621.
    const fares = await driveEveryoneHome();
    for (const booking of [nusrats, shirins]) {
      expect(fares.get(booking.id)).toMatchObject({
        actualKm: '1.835',
        sharedKm: '1.835',
        optionMultiplier: '1.05',
        estimatedFare: '70.04',
        computedFare: '54.62',
        finalFare: '54.62',
      });
    }
    // The women are dropped off, so Rafiq's request is open to Jashim again.
    expect(await nearbyRequestIds(server, driver)).toEqual([rafiqs.id]);
  });

  it('holds a Pool rider to their gender when a Same-gender request asks to join', async () => {
    const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    await accepted(rafiqs);
    const nusrats = await requestRide(
      server,
      nusrat,
      tripFrom(BANANI, { rideOption: 'same_gender' }),
    );
    const shirins = await requestRide(server, shirin, tripFrom(BANANI));

    expect((await trip())?.joinRule).toBe('anyone');
    expect(await nearbyRequestIds(server, driver)).toEqual([shirins.id]);
    expect((await refusal(nusrats)).status).toBe(422);
    await accepted(shirins);
    await expectSeatsMatchBookings(pool);
    await expectRideOptionsHeld(pool);
  });
});

describe('route checks per refresh with ride options (NFR-3)', () => {
  let ors: FakeOrs;
  let routed: TestServer;
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

  it('spends no map request on requests the options rule out', async () => {
    ors.behave({ kind: 'distances', meters: roadMeters });
    const nusrats = await requestRide(
      routed,
      nusrat,
      tripFrom(BANANI, { rideOption: 'same_gender' }),
    );
    expect((await acceptRequest(routed, driver, nusrats.id)).status).toBe(200);

    // Four men ask first, along Nusrat's way; then one woman does.
    for (let i = 0; i < 4; i += 1) {
      const cookie = await signUpAs(
        routed,
        passengerSignUp({
          name: `Rider ${i + 1}`,
          email: `rider${i + 1}@example.com`,
          gender: 'male',
        }),
      );
      const pickup = { ...BANANI, lat: BANANI.lat - 0.0005 * (i + 1), label: `Banani ${i + 1}` };
      await requestRide(routed, cookie, tripFrom(pickup));
    }
    const pickup = { ...BANANI, lat: BANANI.lat - 0.0025, label: 'Banani 5' };
    const shirins = await requestRide(routed, shirin, tripFrom(pickup));

    ors.matrixHits = 0;
    expect(await nearbyRequestIds(routed, driver)).toEqual([shirins.id]);
    expect(ors.matrixHits).toBe(1);
  });
});
