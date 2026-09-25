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
  MOHAKHALI,
  UTTARA,
  goOnlineAt,
  nearbyRequestIds,
  requestRide,
  tripFrom,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';

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

describe('GET /driver/requests (FR-D5, FR-D6)', () => {
  it('shows nothing to an offline driver', async () => {
    await requestRide(server, nusrat);
    await goOnlineAt(server, driver);
    await postJson(server, '/api/v1/driver/vehicle/offline', {}, driver);

    expect(await nearbyRequestIds(server, driver)).toEqual([]);
  });

  it('shows an online driver a request near their Tesla, without the passenger', async () => {
    await goOnlineAt(server, driver, BANANI);
    const booking = await requestRide(server, nusrat, tripFrom(MOHAKHALI));

    const res = await getJson(server, '/api/v1/driver/requests', driver);
    expect(res.status).toBe(200);
    const { requests } = (await res.json()) as { requests: Array<Record<string, unknown>> };
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request).toMatchObject({
      id: booking.id,
      pickup: MOHAKHALI,
      destination: BANANI,
      seats: 1,
      rideOption: 'pool',
      paymentMethod: 'cash',
      estimatedFare: booking.estimatedFare,
    });
    // Mohakhali is about 1.7 km from Banani Road 11 in a straight line.
    expect(Number(request?.pickupDistanceKm)).toBeGreaterThan(1.5);
    expect(Number(request?.pickupDistanceKm)).toBeLessThan(2);
    // A driver sees where, never who, before accepting (NFR-9).
    expect(JSON.stringify(request)).not.toContain('Nusrat');
    expect(request).not.toHaveProperty('passengerId');
  });

  it('leaves out requests beyond the search radius', async () => {
    await goOnlineAt(server, driver, BANANI);
    await requestRide(server, nusrat, tripFrom(UTTARA));

    expect(await nearbyRequestIds(server, driver)).toEqual([]);
  });

  it('uses the configured radius', async () => {
    const narrow = await startTestServer(pool, undefined, { searchRadiusKm: 0.5 });
    try {
      await goOnlineAt(server, driver, BANANI);
      await requestRide(server, nusrat, tripFrom(MOHAKHALI));
      await requestRide(server, rafiq, tripFrom(BANANI));

      const res = await getJson(narrow, '/api/v1/driver/requests', driver);
      const { requests } = (await res.json()) as { requests: Array<{ pickup: unknown }> };
      expect(requests.map((r) => r.pickup)).toEqual([BANANI]);
    } finally {
      await narrow.close();
    }
  });

  it('leaves out requests with more seats than the Tesla has', async () => {
    // A bigger Tesla elsewhere makes a 4-seat request valid; Bullet still can't carry it.
    await signUpAs(
      server,
      driverSignUp({ email: 'big@example.com', vehicle: { name: 'Big', capacity: 6 } }),
    );
    await goOnlineAt(server, driver, BANANI);
    await requestRide(server, nusrat, tripFrom(BANANI, { seats: 4 }));

    expect(await nearbyRequestIds(server, driver)).toEqual([]);
  });

  it('lists the oldest request first', async () => {
    await goOnlineAt(server, driver, BANANI);
    const first = await requestRide(server, rafiq, tripFrom(GULSHAN_1));
    const second = await requestRide(server, nusrat, tripFrom(MOHAKHALI));

    expect(await nearbyRequestIds(server, driver)).toEqual([first.id, second.id]);
  });

  it('leaves out cancelled requests', async () => {
    await goOnlineAt(server, driver, BANANI);
    const booking = await requestRide(server, nusrat);
    await postJson(server, `/api/v1/bookings/${booking.id}/cancel`, {}, nusrat);

    expect(await nearbyRequestIds(server, driver)).toEqual([]);
  });

  it('is for drivers only', async () => {
    expect((await getJson(server, '/api/v1/driver/requests', nusrat)).status).toBe(403);
    expect((await getJson(server, '/api/v1/driver/requests')).status).toBe(401);
  });
});
