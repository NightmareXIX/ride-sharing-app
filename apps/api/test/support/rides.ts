import type pg from 'pg';
import { expect } from 'vitest';
import { getJson, postJson, sendJson } from './accounts.js';
import type { TestServer } from './server.js';

// Story places (the quick picks). Mohakhali and Gulshan 1 are under 2 km from Banani in a
// straight line; Uttara is far outside any driver's radius there. Mohakhali is at Wireless
// Gate, where the road to Gulshan 1 begins, so Nusrat and Rafiq pool (phase 5 LLD §7).
export const BANANI = { lat: 23.7937, lng: 90.4066, label: 'Banani Road 11' };
export const MOHAKHALI = { lat: 23.7812, lng: 90.409, label: 'Mohakhali' };
export const GULSHAN_1 = { lat: 23.7806, lng: 90.4163, label: 'Gulshan 1' };
export const UTTARA = { lat: 23.8759, lng: 90.3795, label: 'Uttara' };

export function tripFrom(pickup = BANANI, overrides: Record<string, unknown> = {}) {
  return {
    pickup,
    destination: pickup === MOHAKHALI ? BANANI : MOHAKHALI,
    seats: 1,
    rideOption: 'pool',
    paymentMethod: 'cash',
    ...overrides,
  };
}

export interface BookingBody {
  id: string;
  status: string;
  [key: string]: unknown;
}

async function expectStatus(res: Response, status: number): Promise<unknown> {
  if (res.status !== status) {
    throw new Error(`Expected ${status}, got ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Puts the driver's Tesla at a place and online.
export async function goOnlineAt(
  server: TestServer,
  driver: string,
  place: { lat: number; lng: number } = BANANI,
): Promise<void> {
  const where = { lat: place.lat, lng: place.lng };
  await expectStatus(
    await sendJson(server, 'PUT', '/api/v1/driver/vehicle/location', where, driver),
    200,
  );
  await expectStatus(await postJson(server, '/api/v1/driver/vehicle/online', {}, driver), 200);
}

// A passenger's ride request; returns the booking.
export async function requestRide(
  server: TestServer,
  passenger: string,
  trip: unknown = tripFrom(),
): Promise<BookingBody> {
  const body = await expectStatus(await postJson(server, '/api/v1/bookings', trip, passenger), 201);
  return (body as { booking: BookingBody }).booking;
}

export function acceptRequest(server: TestServer, driver: string, bookingId: string) {
  return postJson(server, `/api/v1/driver/requests/${bookingId}/accept`, {}, driver);
}

export function driverAction(
  server: TestServer,
  driver: string,
  bookingId: string,
  action: 'arrive' | 'start' | 'complete' | 'cancel' | 'no-show',
) {
  return postJson(server, `/api/v1/driver/bookings/${bookingId}/${action}`, {}, driver);
}

export async function nearbyRequestIds(server: TestServer, driver: string): Promise<string[]> {
  const body = await expectStatus(await getJson(server, '/api/v1/driver/requests', driver), 200);
  return (body as { requests: Array<{ id: string }> }).requests.map((r) => r.id);
}

export async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

// Seats taken in the Tesla with this name, as the database holds them.
export async function seatsTaken(pool: pg.Pool, vehicleName = 'Bullet'): Promise<number> {
  const { rows } = await pool.query<{ occupied_seats: number }>(
    'SELECT occupied_seats FROM vehicles WHERE name = $1',
    [vehicleName],
  );
  if (!rows[0]) throw new Error(`No Tesla named ${vehicleName}`);
  return rows[0].occupied_seats;
}

// Every Tesla's seats taken equal the seats of the bookings it carries: those in its
// active trip that are accepted, waiting at pickup or aboard (phase 4 LLD §2).
export async function expectSeatsMatchBookings(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ name: string; occupied_seats: number; held: number }>(
    `SELECT v.name, v.occupied_seats, coalesce(sum(b.seats), 0)::integer AS held
     FROM vehicles v
     LEFT JOIN pools p ON p.vehicle_id = v.id AND p.status = 'active'
     LEFT JOIN bookings b ON b.pool_id = p.id
       AND b.status IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')
     GROUP BY v.id, v.name, v.occupied_seats`,
  );
  for (const row of rows) expect(row.occupied_seats, row.name).toBe(row.held);
}

// No trip breaks its ride options (phase 7 LLD §4): a Solo booking is alone among the
// bookings with the driver, and a trip with a Same-gender booking holds one gender.
export async function expectRideOptionsHeld(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT p.id FROM pools p
     JOIN bookings b ON b.pool_id = p.id
       AND b.status IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')
     JOIN users u ON u.id = b.passenger_id
     WHERE p.status = 'active'
     GROUP BY p.id
     HAVING (bool_or(b.ride_option = 'solo') AND count(*) > 1)
         OR (bool_or(b.ride_option = 'same_gender') AND count(DISTINCT u.gender) > 1)`,
  );
  expect(rows, 'trips that break their ride options').toEqual([]);
}

// Clears every ride but keeps the accounts, so a race can run many rounds without new
// sign-ups. TRUNCATE doesn't fire the append-only row triggers. The cascade empties the
// wallet ledger too, so every balance goes back to zero with it.
export async function resetRides(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE bookings, pools, wallet_transactions CASCADE');
  await pool.query('UPDATE vehicles SET occupied_seats = 0');
  await pool.query('UPDATE wallets SET balance = 0');
}

// Only the database clock counts for the 3-minute and 5-minute windows (NFR-38), so tests
// move a booking's acceptance or arrival back in SQL, e.g. by '3 minutes 1 second'.
export async function ageAcceptance(pool: pg.Pool, bookingId: string, by: string): Promise<void> {
  await pool.query('UPDATE bookings SET accepted_at = accepted_at - $2::interval WHERE id = $1', [
    bookingId,
    by,
  ]);
}

export async function ageArrival(pool: pg.Pool, bookingId: string, by: string): Promise<void> {
  await pool.query('UPDATE bookings SET arrived_at = arrived_at - $2::interval WHERE id = $1', [
    bookingId,
    by,
  ]);
}

// Every trip's route matches its bookings (phase 5 LLD §4): each booking with the driver
// has one pickup and one drop-off in its trip, the pickup first; nobody else has a stop
// still to come; and the stops reached come before those still ahead.
export async function expectRouteMatchesBookings(pool: pg.Pool): Promise<void> {
  const { rows: missing } = await pool.query(
    `SELECT b.id FROM bookings b
     WHERE b.status IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')
       AND (
         SELECT count(*) FILTER (WHERE s.type = 'pickup') <> 1
           OR count(*) FILTER (WHERE s.type = 'dropoff') <> 1
           OR max(s.sequence) FILTER (WHERE s.type = 'pickup')
              > min(s.sequence) FILTER (WHERE s.type = 'dropoff')
         FROM route_stops s WHERE s.booking_id = b.id AND s.pool_id = b.pool_id
       )`,
  );
  expect(missing, 'bookings without a pickup and a drop-off').toEqual([]);

  const { rows: strays } = await pool.query(
    `SELECT s.id FROM route_stops s JOIN bookings b ON b.id = s.booking_id
     WHERE s.reached_at IS NULL
       AND (b.pool_id IS DISTINCT FROM s.pool_id
         OR b.status NOT IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED'))`,
  );
  expect(strays, 'stops still ahead for bookings not with the driver').toEqual([]);

  const { rows: outOfOrder } = await pool.query(
    `SELECT pool_id FROM route_stops GROUP BY pool_id
     HAVING max(sequence) FILTER (WHERE reached_at IS NOT NULL)
          > min(sequence) FILTER (WHERE reached_at IS NULL)`,
  );
  expect(outOfOrder, 'trips with a stop reached after one still ahead').toEqual([]);
}
