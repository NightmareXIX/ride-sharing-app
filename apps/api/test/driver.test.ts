import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
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
import { acceptRequest, errorCode, goOnlineAt, requestRide } from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';

let pool: pg.Pool;
let server: TestServer;
let driver: string;

const BANANI = { lat: 23.7937, lng: 90.4066 };

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
});

function setLocation(body: unknown, cookie = driver) {
  return sendJson(server, 'PUT', '/api/v1/driver/vehicle/location', body, cookie);
}

function goOnline(cookie = driver) {
  return postJson(server, '/api/v1/driver/vehicle/online', {}, cookie);
}

function goOffline(cookie = driver) {
  return postJson(server, '/api/v1/driver/vehicle/offline', {}, cookie);
}

async function vehicleOf(res: Response) {
  expect(res.status).toBe(200);
  return ((await res.json()) as { vehicle: Record<string, unknown> }).vehicle;
}

describe('driver Tesla (FR-D3, FR-D4)', () => {
  it('starts offline with no location and no seats taken', async () => {
    const vehicle = await vehicleOf(await getJson(server, '/api/v1/driver/vehicle', driver));

    expect(vehicle).toEqual({
      id: expect.any(String),
      name: 'Bullet',
      capacity: 3,
      occupiedSeats: 0,
      isOnline: false,
      location: null,
    });
  });

  it('refuses to go online before a location is set', async () => {
    const res = await goOnline();

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'LOCATION_REQUIRED' } });
    const vehicle = await vehicleOf(await getJson(server, '/api/v1/driver/vehicle', driver));
    expect(vehicle.isOnline).toBe(false);
  });

  it('sets a location, rounded to 6 decimal places', async () => {
    const vehicle = await vehicleOf(await setLocation({ lat: 23.79370049, lng: 90.4066 }));

    expect(vehicle.location).toEqual({ lat: 23.7937, lng: 90.4066 });
  });

  it('refuses a location outside Dhaka', async () => {
    const res = await setLocation({ lat: 22.3569, lng: 91.7832 }); // Chattogram

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { details: Array<{ path: string }> } };
    expect(body.error.details.map((detail) => detail.path).sort()).toEqual(['lat', 'lng']);
  });

  it('goes online and offline, and repeating either is harmless (NFR-37)', async () => {
    await setLocation(BANANI);

    expect((await vehicleOf(await goOnline())).isOnline).toBe(true);
    expect((await vehicleOf(await goOnline())).isOnline).toBe(true);
    expect((await vehicleOf(await goOffline())).isOnline).toBe(false);
    expect((await vehicleOf(await goOffline())).isOnline).toBe(false);
  });

  it('keeps the location when going offline', async () => {
    await setLocation(BANANI);
    await goOnline();

    expect((await vehicleOf(await goOffline())).location).toEqual(BANANI);
  });

  it('lets an online driver move', async () => {
    await setLocation(BANANI);
    await goOnline();

    const vehicle = await vehicleOf(await setLocation({ lat: 23.7806, lng: 90.4163 }));
    expect(vehicle).toMatchObject({ isOnline: true, location: { lat: 23.7806, lng: 90.4163 } });
  });

  it('refuses a passenger (403) and a visitor with no session (401)', async () => {
    const passenger = await signUpAs(server, passengerSignUp());

    expect((await getJson(server, '/api/v1/driver/vehicle', passenger)).status).toBe(403);
    expect((await goOnline(passenger)).status).toBe(403);
    expect((await setLocation(BANANI, passenger)).status).toBe(403);
    expect((await getJson(server, '/api/v1/driver/vehicle')).status).toBe(401);
  });
});

describe('a driver with a passenger (FR-D3)', () => {
  beforeEach(async () => {
    const nusrat = await signUpAs(server, passengerSignUp());
    await goOnlineAt(server, driver);
    const booking = await requestRide(server, nusrat);
    expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);
  });

  it("can't go offline", async () => {
    const res = await goOffline();
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('HAS_ACTIVE_BOOKINGS');
    const { vehicle } = (await (
      await getJson(server, '/api/v1/driver/vehicle', driver)
    ).json()) as {
      vehicle: { isOnline: boolean };
    };
    expect(vehicle.isOnline).toBe(true);
  });

  it("can't move the Tesla", async () => {
    const res = await setLocation({ lat: 23.78, lng: 90.41 });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('HAS_ACTIVE_BOOKINGS');
  });
});
