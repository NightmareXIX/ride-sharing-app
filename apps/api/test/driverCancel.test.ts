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
  driverAction,
  errorCode,
  goOnlineAt,
  nearbyRequestIds,
  requestRide,
  type BookingBody,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';

let pool: pg.Pool;
let server: TestServer;
let driver: string;
let nusrat: string;
let booking: BookingBody;
let poolId: string;

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
  await goOnlineAt(server, driver);
  booking = await requestRide(server, nusrat);
  const res = await acceptRequest(server, driver, booking.id);
  poolId = ((await res.json()) as { pool: { id: string } }).pool.id;
});

async function bookingRow() {
  const { rows } = await pool.query<{
    status: string;
    pool_id: string | null;
    accepted_at: Date | null;
    arrived_at: Date | null;
    requested_at: Date;
  }>('SELECT status, pool_id, accepted_at, arrived_at, requested_at FROM bookings WHERE id = $1', [
    booking.id,
  ]);
  const [row] = rows;
  if (!row) throw new Error('booking not found');
  return row;
}

describe('POST /driver/bookings/:id/cancel (FR-D12)', () => {
  it.each([
    ['after accepting', []],
    ['after arriving', ['arrive']],
  ] as const)('puts the request back for other drivers %s', async (_name, before) => {
    for (const action of before) await driverAction(server, driver, booking.id, action);
    const { requested_at: requestedAt } = await bookingRow();

    const res = await driverAction(server, driver, booking.id, 'cancel');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pool: null });

    // Waiting again, with no driver, and still in its original place in the queue.
    expect(await bookingRow()).toEqual({
      status: 'REQUESTED',
      pool_id: null,
      accepted_at: null,
      arrived_at: null,
      requested_at: requestedAt,
    });

    // The history keeps the trip it left (FR-R11).
    const { rows } = await pool.query<{ reason: string; pool_id: string | null }>(
      `SELECT reason, pool_id FROM booking_status_history
       WHERE booking_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [booking.id],
    );
    expect(rows).toEqual([{ reason: 'driver_cancel', pool_id: poolId }]);

    // The trip is over, and the request is listed again (FR-D12).
    const { rows: pools } = await pool.query<{ status: string }>('SELECT status FROM pools');
    expect(pools).toEqual([{ status: 'finished' }]);
    expect(await nearbyRequestIds(server, driver)).toEqual([booking.id]);
  });

  it('lets another driver accept the re-surfaced request', async () => {
    const other = await signUpAs(
      server,
      driverSignUp({
        name: 'Karim',
        email: 'karim@example.com',
        vehicle: { name: 'Arrow', capacity: 3 },
      }),
    );
    await goOnlineAt(server, other);
    await driverAction(server, driver, booking.id, 'cancel');

    expect((await acceptRequest(server, other, booking.id)).status).toBe(200);
  });

  it('treats a second tap as the same cancel (NFR-37)', async () => {
    await driverAction(server, driver, booking.id, 'cancel');

    const again = await driverAction(server, driver, booking.id, 'cancel');
    expect(again.status).toBe(200);
    const { rows } = await pool.query(
      "SELECT id FROM booking_status_history WHERE reason = 'driver_cancel'",
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses once the passenger is aboard', async () => {
    await driverAction(server, driver, booking.id, 'arrive');
    await driverAction(server, driver, booking.id, 'start');

    const res = await driverAction(server, driver, booking.id, 'cancel');
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('INVALID_TRANSITION');
    expect((await bookingRow()).status).toBe('STARTED');
  });

  it("hides another driver's passenger (NFR-8)", async () => {
    const other = await signUpAs(
      server,
      driverSignUp({
        name: 'Karim',
        email: 'karim@example.com',
        vehicle: { name: 'Arrow', capacity: 3 },
      }),
    );

    expect((await driverAction(server, other, booking.id, 'cancel')).status).toBe(404);
    expect((await bookingRow()).status).toBe('ACCEPTED');
  });

  it('frees the driver to go offline', async () => {
    await driverAction(server, driver, booking.id, 'cancel');

    expect(await (await getJson(server, '/api/v1/driver/pool', driver)).json()).toEqual({
      pool: null,
    });
    expect((await postJson(server, '/api/v1/driver/vehicle/offline', {}, driver)).status).toBe(200);
  });
});
