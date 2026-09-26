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
  acceptRequest,
  ageArrival,
  BANANI,
  driverAction,
  GULSHAN_1,
  goOnlineAt,
  MOHAKHALI,
  requestRide,
  tripFrom,
  type BookingBody,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';

// Near Banani Road 11 but not on any stop, so a move to a stop can't pass unnoticed.
const START = { lat: 23.7925, lng: 90.4078 };

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

async function teslaAt(): Promise<{ lat: number; lng: number } | null> {
  const res = await getJson(server, '/api/v1/driver/vehicle', driver);
  return ((await res.json()) as { vehicle: { location: { lat: number; lng: number } | null } })
    .vehicle.location;
}

async function step(
  booking: BookingBody,
  action: 'arrive' | 'start' | 'complete' | 'cancel' | 'no-show',
) {
  const res = await driverAction(server, driver, booking.id, action);
  if (res.status !== 200) throw new Error(`${action}: ${res.status} ${await res.text()}`);
}

async function accepted(passenger: string, trip = tripFrom(BANANI)): Promise<BookingBody> {
  const booking = await requestRide(server, passenger, trip);
  expect((await acceptRequest(server, driver, booking.id)).status).toBe(200);
  return booking;
}

// The route is planned from the saved location, so it stays put while the trip is on
// (driver-map LLD §2), and becomes where the trip ended once it is over (§3).
describe('where the Tesla is left when its trip ends (driver-map LLD)', () => {
  it('stays put during a ride, then moves to the drop-off', async () => {
    await goOnlineAt(server, driver, START);
    const booking = await accepted(nusrat);

    await step(booking, 'arrive');
    expect(await teslaAt()).toEqual(START);
    await step(booking, 'start');
    expect(await teslaAt()).toEqual(START);
    await step(booking, 'complete');
    expect(await teslaAt()).toEqual({ lat: MOHAKHALI.lat, lng: MOHAKHALI.lng });
  });

  it('moves only when the last passenger of a pooled trip is dropped off', async () => {
    await goOnlineAt(server, driver, BANANI);
    const nusrats = await accepted(nusrat);
    const rafiqs = await accepted(rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    for (const booking of [nusrats, rafiqs]) {
      await step(booking, 'arrive');
      await step(booking, 'start');
    }

    // Nusrat's drop-off at Mohakhali comes first; Rafiq is still aboard.
    await step(nusrats, 'complete');
    expect(await teslaAt()).toEqual({ lat: BANANI.lat, lng: BANANI.lng });
    await step(rafiqs, 'complete');
    expect(await teslaAt()).toEqual({ lat: GULSHAN_1.lat, lng: GULSHAN_1.lng });
  });

  it('is left at the pickup where the driver waited for a no-show', async () => {
    await goOnlineAt(server, driver, START);
    const booking = await accepted(nusrat);
    await step(booking, 'arrive');
    await ageArrival(pool, booking.id, '5 minutes');

    await step(booking, 'no-show');
    expect(await teslaAt()).toEqual({ lat: BANANI.lat, lng: BANANI.lng });
  });

  it('stays put when a driver cancel ends the trip before any stop', async () => {
    await goOnlineAt(server, driver, START);
    const booking = await accepted(nusrat);

    await step(booking, 'cancel');
    expect(await teslaAt()).toEqual(START);
  });

  it('stays put when a passenger cancel ends the trip before any stop', async () => {
    await goOnlineAt(server, driver, START);
    const booking = await accepted(nusrat);

    const res = await postJson(server, `/api/v1/bookings/${booking.id}/cancel`, {}, nusrat);
    expect(res.status).toBe(200);
    expect(await teslaAt()).toEqual(START);
  });
});
