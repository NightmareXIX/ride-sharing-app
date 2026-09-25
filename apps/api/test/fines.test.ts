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
  acceptRequest,
  ageAcceptance,
  ageArrival,
  driverAction,
  errorCode,
  expectRouteMatchesBookings,
  expectSeatsMatchBookings,
  goOnlineAt,
  requestRide,
  tripFrom,
  type BookingBody,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';
import {
  allTransactions,
  balanceOf,
  entriesFor,
  expectLedgerConsistent,
  topUp,
} from './support/wallet.js';

let pool: pg.Pool;
let server: TestServer;
let jashim: string;
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
  jashim = await signUpAs(server, driverSignUp());
  nusrat = await signUpAs(server, passengerSignUp());
  rafiq = await signUpAs(
    server,
    passengerSignUp({ name: 'Rafiq', email: 'rafiq@example.com', gender: 'male' }),
  );
  await goOnlineAt(server, jashim, BANANI);
});

interface Booking extends BookingBody {
  cancelFine: string | null;
  fine: { amount: string; reason: string } | null;
}

async function cancel(booking: BookingBody, passenger = nusrat): Promise<Booking> {
  const res = await postJson(server, `/api/v1/bookings/${booking.id}/cancel`, {}, passenger);
  if (res.status !== 200) throw new Error(`cancel: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { booking: Booking }).booking;
}

async function current(passenger = nusrat): Promise<Booking | null> {
  const res = await getJson(server, '/api/v1/bookings/current', passenger);
  return ((await res.json()) as { booking: Booking | null }).booking;
}

async function accepted(paymentMethod: 'cash' | 'teslapay' = 'cash'): Promise<BookingBody> {
  const booking = await requestRide(server, nusrat, tripFrom(BANANI, { paymentMethod }));
  expect((await acceptRequest(server, jashim, booking.id)).status).toBe(200);
  return booking;
}

describe('a passenger cancel (FR-P7, FR-W6)', () => {
  it('is free while the request waits for a driver', async () => {
    const booking = await requestRide(server, nusrat);
    expect(await cancel(booking)).toMatchObject({ cancelFine: null, fine: null });
    expect(await entriesFor(pool, booking.id)).toEqual([]);
  });

  it.each([
    ['after acceptance', []],
    ['after the driver arrives', ['arrive']],
  ] as const)('is free within 3 minutes, %s', async (_name, before) => {
    const booking = await accepted();
    for (const action of before) await driverAction(server, jashim, booking.id, action);
    await ageAcceptance(pool, booking.id, '2 minutes 55 seconds');

    expect((await current())?.cancelFine).toBeNull();
    expect(await cancel(booking)).toMatchObject({ status: 'CANCELLED', fine: null });
    expect(await balanceOf(server, nusrat)).toBe('0.00');
  });

  it.each([['cash'], ['teslapay']] as const)(
    'costs 30 tk after 3 minutes, paying by %s',
    async (paymentMethod) => {
      await topUp(server, nusrat, '100.00');
      const booking = await accepted(paymentMethod);
      await ageAcceptance(pool, booking.id, '3 minutes 1 second');

      expect((await current())?.cancelFine).toBe('30.00');
      const cancelled = await cancel(booking);
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        cancelFine: null,
        fine: { amount: '30.00', reason: 'late_cancel' },
      });

      expect(await balanceOf(server, nusrat)).toBe('70.00');
      expect(await entriesFor(pool, booking.id)).toEqual([
        { type: 'fine', amount: '-30.00', email: 'nusrat@example.com' },
      ]);
      const [fine] = await allTransactions(server, nusrat);
      expect(fine).toMatchObject({ type: 'fine', reason: 'late_cancel', balanceAfter: '70.00' });
      await expectLedgerConsistent(pool);
    },
  );

  it('fines once when Cancel is pressed twice (NFR-37)', async () => {
    const booking = await accepted();
    await ageAcceptance(pool, booking.id, '4 minutes');
    await cancel(booking);
    await cancel(booking);

    expect(await balanceOf(server, nusrat)).toBe('-30.00');
    expect(await entriesFor(pool, booking.id)).toHaveLength(1);
  });

  it('may take the balance below zero, which blocks new requests until a top-up (FR-W7)', async () => {
    const booking = await accepted();
    await ageAcceptance(pool, booking.id, '4 minutes');
    await cancel(booking);
    expect(await balanceOf(server, nusrat)).toBe('-30.00');

    const refused = await postJson(server, '/api/v1/bookings', tripFrom(BANANI), nusrat);
    expect(refused.status).toBe(422);
    expect(await errorCode(refused)).toBe('NEGATIVE_BALANCE');

    expect(await topUp(server, nusrat, '30.00')).toBe('0.00');
    expect((await requestRide(server, nusrat)).status).toBe('REQUESTED');
    await expectLedgerConsistent(pool);
  });
});

interface TripBooking {
  id: string;
  status: string;
  noShowFrom: string | null;
  canNoShow: boolean;
}

interface Trip {
  seats: { taken: number };
  stops: Array<{ bookingId: string; type: string; plannedOdometerKm: string }>;
  bookings: TripBooking[];
}

async function trip(): Promise<Trip | null> {
  const res = await getJson(server, '/api/v1/driver/pool', jashim);
  return ((await res.json()) as { pool: Trip | null }).pool;
}

async function arrived(): Promise<BookingBody> {
  const booking = await accepted();
  expect((await driverAction(server, jashim, booking.id, 'arrive')).status).toBe(200);
  return booking;
}

async function noShow(booking: BookingBody, driver = jashim) {
  return driverAction(server, driver, booking.id, 'no-show');
}

describe('a no-show (FR-D11)', () => {
  it('shows the driver when a no-show becomes possible', async () => {
    const booking = await accepted();
    expect((await trip())?.bookings[0]).toMatchObject({ noShowFrom: null, canNoShow: false });

    await driverAction(server, jashim, booking.id, 'arrive');
    const waiting = (await trip())?.bookings[0];
    expect(waiting?.canNoShow).toBe(false);
    const { rows } = await pool.query<{ arrived_at: Date }>(
      'SELECT arrived_at FROM bookings WHERE id = $1',
      [booking.id],
    );
    expect(Date.parse(waiting?.noShowFrom as string) - Number(rows[0]?.arrived_at)).toBe(
      5 * 60_000,
    );

    await ageArrival(pool, booking.id, '5 minutes');
    expect((await trip())?.bookings[0]?.canNoShow).toBe(true);
  });

  it('is refused before 5 minutes have passed, and changes nothing', async () => {
    const booking = await arrived();
    await ageArrival(pool, booking.id, '4 minutes 59 seconds');

    const res = await noShow(booking);
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('NO_SHOW_TOO_EARLY');
    expect((await current())?.status).toBe('DRIVER_ARRIVED');
    expect(await entriesFor(pool, booking.id)).toEqual([]);
  });

  it('cancels the booking, frees the Tesla and fines the passenger after 5 minutes', async () => {
    await topUp(server, nusrat, '10.00');
    const booking = await arrived();
    await ageArrival(pool, booking.id, '5 minutes');

    const res = await noShow(booking);
    expect(res.status).toBe(200);
    // Nusrat was the only passenger, so the trip ends.
    expect(await res.json()).toEqual({ pool: null });

    const seen = await getJson(server, `/api/v1/bookings/${booking.id}`, nusrat);
    expect(((await seen.json()) as { booking: Booking }).booking).toMatchObject({
      status: 'CANCELLED',
      fine: { amount: '30.00', reason: 'no_show' },
    });
    const { rows } = await pool.query(
      `SELECT from_status, to_status, reason FROM booking_status_history
       WHERE booking_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [booking.id],
    );
    expect(rows).toEqual([
      { from_status: 'DRIVER_ARRIVED', to_status: 'CANCELLED', reason: 'no_show' },
    ]);
    expect(await balanceOf(server, nusrat)).toBe('-20.00');
    expect(await entriesFor(pool, booking.id)).toEqual([
      { type: 'fine', amount: '-30.00', email: 'nusrat@example.com' },
    ]);
    await expectSeatsMatchBookings(pool);
    await expectRouteMatchesBookings(pool);
    await expectLedgerConsistent(pool);
  });

  it('re-plans the rest of the route when others are aboard', async () => {
    const nusrats = await accepted();
    const rafiqs = await requestRide(server, rafiq, tripFrom(BANANI, { destination: GULSHAN_1 }));
    expect((await acceptRequest(server, jashim, rafiqs.id)).status).toBe(200);
    await driverAction(server, jashim, nusrats.id, 'arrive');
    await driverAction(server, jashim, nusrats.id, 'start');
    await driverAction(server, jashim, rafiqs.id, 'arrive');
    await ageArrival(pool, rafiqs.id, '6 minutes');

    expect((await noShow(rafiqs)).status).toBe(200);
    const after = await trip();
    expect(after?.seats.taken).toBe(1);
    expect(
      after?.stops.map(
        (stop) => `${stop.bookingId === nusrats.id ? 'Nusrat' : 'Rafiq'} ${stop.type}`,
      ),
    ).toEqual(['Nusrat pickup', 'Nusrat dropoff']);
    await expectRouteMatchesBookings(pool);
    await expectSeatsMatchBookings(pool);
  });

  it('fines once when pressed twice (NFR-37)', async () => {
    const booking = await arrived();
    await ageArrival(pool, booking.id, '5 minutes');
    expect((await noShow(booking)).status).toBe(200);
    expect((await noShow(booking)).status).toBe(200);
    expect(await entriesFor(pool, booking.id)).toHaveLength(1);
    expect(await balanceOf(server, nusrat)).toBe('-30.00');
  });

  it('is refused before arrival and once the passenger is aboard (FR-R8)', async () => {
    const booking = await accepted();
    const early = await noShow(booking);
    expect(early.status).toBe(409);
    expect(await errorCode(early)).toBe('INVALID_TRANSITION');

    await driverAction(server, jashim, booking.id, 'arrive');
    await ageArrival(pool, booking.id, '6 minutes');
    await driverAction(server, jashim, booking.id, 'start');
    const aboard = await noShow(booking);
    expect(aboard.status).toBe(409);
    expect(await errorCode(aboard)).toBe('INVALID_TRANSITION');
    expect(await entriesFor(pool, booking.id)).toEqual([]);
  });

  it("is not found for another driver's passenger (NFR-8)", async () => {
    const other = await signUpAs(
      server,
      driverSignUp({
        name: 'Other',
        email: 'other@example.com',
        vehicle: { name: 'Arrow', capacity: 3 },
      }),
    );
    const booking = await arrived();
    await ageArrival(pool, booking.id, '6 minutes');

    const res = await noShow(booking, other);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('NOT_FOUND');
    expect((await current())?.status).toBe('DRIVER_ARRIVED');
  });

  it('is for drivers only', async () => {
    const booking = await arrived();
    const res = await postJson(server, `/api/v1/driver/bookings/${booking.id}/no-show`, {}, nusrat);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('WRONG_ROLE');
  });
});

async function penalties(): Promise<Array<{ booking_id: string; reason: string }>> {
  const { rows } = await pool.query<{ booking_id: string; reason: string }>(
    'SELECT booking_id, reason FROM driver_penalties ORDER BY created_at',
  );
  return rows;
}

async function penaltyCount(): Promise<number> {
  const res = await getJson(server, '/api/v1/driver/vehicle', jashim);
  return ((await res.json()) as { vehicle: { penaltyCount: number } }).vehicle.penaltyCount;
}

describe('a driver cancel (FR-D13)', () => {
  it('records no penalty within 3 minutes of accepting', async () => {
    const booking = await accepted();
    await ageAcceptance(pool, booking.id, '2 minutes 55 seconds');
    const [seen] = (await trip())?.bookings ?? [];
    expect(seen).toMatchObject({ cancelRecordsPenalty: false });

    expect((await driverAction(server, jashim, booking.id, 'cancel')).status).toBe(200);
    expect(await penalties()).toEqual([]);
    expect(await penaltyCount()).toBe(0);
  });

  it('records a penalty after 3 minutes, and never fines the passenger', async () => {
    await topUp(server, nusrat, '50.00');
    const booking = await accepted();
    await driverAction(server, jashim, booking.id, 'arrive');
    await ageAcceptance(pool, booking.id, '3 minutes 1 second');
    expect((await trip())?.bookings[0]).toMatchObject({ cancelRecordsPenalty: true });

    expect((await driverAction(server, jashim, booking.id, 'cancel')).status).toBe(200);
    expect((await driverAction(server, jashim, booking.id, 'cancel')).status).toBe(200);

    expect(await penalties()).toEqual([{ booking_id: booking.id, reason: 'late_driver_cancel' }]);
    expect(await penaltyCount()).toBe(1);
    // The request waits for a driver again, and Nusrat keeps her money.
    expect((await current())?.status).toBe('REQUESTED');
    expect(await balanceOf(server, nusrat)).toBe('50.00');
    expect(await entriesFor(pool, booking.id)).toEqual([]);
  });

  it('keeps penalty records forever (NFR-40)', async () => {
    const booking = await accepted();
    await ageAcceptance(pool, booking.id, '4 minutes');
    await driverAction(server, jashim, booking.id, 'cancel');

    await expect(pool.query("UPDATE driver_penalties SET reason = 'x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query('DELETE FROM driver_penalties')).rejects.toThrow(/append-only/);
  });
});
