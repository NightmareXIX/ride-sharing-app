import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  bookings,
  bookingStatusHistory,
  driverPenalties,
  type Booking,
  fares,
  pools,
  users,
  vehicles,
} from '../db/schema/index.js';
import { FINAL_STATUSES, type PaymentMethod } from '../domain/booking.js';
import type { RideOption } from '../domain/fare.js';
import { AppError } from '../http/errors.js';
import { toPage, type Page, type PageRequest } from '../http/pagination.js';
import type { Place } from './bookings.js';
import { fareColumns, toFareBreakdown, type FareBreakdown } from './fares.js';

// A driver's finished trips and what they earned (FR-D15). Everything here is read from
// what the trip stored as it happened: fares, status history and penalties. Nothing is
// worked out again (NFR-41).

// Money earned, as strings such as "123.44" (API Routes §1).
export interface EarningsSplit {
  total: string;
  cash: string;
  teslapay: string;
}

// One finished trip in the driver's list.
export interface TripSummary {
  id: string;
  createdAt: Date;
  finishedAt: Date | null;
  // Every entry in the trip: each booking it ended, and each passenger the driver dropped.
  passengers: number;
  completed: number;
  // The final fares of the trip's completed rides.
  earnings: EarningsSplit;
}

// How a passenger's time in the trip ended.
export type TripOutcome =
  'completed' | 'passenger_cancelled' | 'late_cancel' | 'no_show' | 'driver_cancelled';

// One passenger in a finished trip, as the driver sees them: their name and fare, never
// their gender or fine (NFR-9).
export interface PastTripBooking {
  id: string;
  passenger: { name: string };
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  estimatedFare: string;
  outcome: TripOutcome;
  endedAt: Date;
  fare: FareBreakdown | null;
  // A drop more than 3 minutes after accepting recorded a penalty (FR-D13).
  penaltyRecorded: boolean;
}

export interface PastTrip extends TripSummary {
  vehicle: { name: string };
  bookings: PastTripBooking[];
}

// The driver's totals over every completed ride.
export interface Earnings extends EarningsSplit {
  rides: number;
}

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'This trip was not found.');
}

// Sums are numeric(12,2), so an empty one reads "0.00".
function money(sum: SQL) {
  return sql<string>`coalesce(${sum}, 0)::numeric(12,2)`;
}

// The final fares of the trip's completed rides, optionally one payment method's.
function tripEarned(method?: PaymentMethod) {
  const byMethod = method ? sql` AND ${bookings.paymentMethod} = ${method}` : sql.empty();
  return money(sql`(
    SELECT sum(${fares.finalFare}) FROM ${fares}
    INNER JOIN ${bookings} ON ${bookings.id} = ${fares.bookingId}
    WHERE ${bookings.poolId} = ${pools.id} AND ${bookings.status} = 'COMPLETED'${byMethod}
  )`);
}

// A drop by the driver empties the booking's pool; the history keeps the trip it left.
const dropsFromTrip = sql`${bookingStatusHistory.poolId} = ${pools.id}
  AND ${bookingStatusHistory.reason} = 'driver_cancel'`;

const tripColumns = {
  id: pools.id,
  seq: pools.seq,
  createdAt: pools.createdAt,
  finishedAt: pools.finishedAt,
  passengers: sql<number>`(
    (SELECT count(*) FROM ${bookings} WHERE ${bookings.poolId} = ${pools.id})
    + (SELECT count(*) FROM ${bookingStatusHistory} WHERE ${dropsFromTrip})
  )`.mapWith(Number),
  completed: sql<number>`(
    SELECT count(*) FROM ${bookings}
    WHERE ${bookings.poolId} = ${pools.id} AND ${bookings.status} = 'COMPLETED'
  )`.mapWith(Number),
  total: tripEarned(),
  cash: tripEarned('cash'),
  teslapay: tripEarned('teslapay'),
};

function toTripSummary(row: Omit<TripSummary, 'earnings'> & EarningsSplit): TripSummary {
  const { id, createdAt, finishedAt, passengers, completed, total, cash, teslapay } = row;
  return { id, createdAt, finishedAt, passengers, completed, earnings: { total, cash, teslapay } };
}

// The driver's own finished trips. Anyone else's trip, and the one in progress, is outside.
function ownFinishedTrips(driverId: string) {
  return and(eq(vehicles.driverId, driverId), eq(pools.status, 'finished'));
}

// The driver's finished trips, newest first, a page at a time (FR-D15, NFR-36). The trip
// in progress is at /driver/pool.
export async function listDriverTrips(
  db: Database,
  driverId: string,
  { after, limit }: PageRequest,
): Promise<Page<TripSummary>> {
  const rows = await db
    .select(tripColumns)
    .from(pools)
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .where(and(ownFinishedTrips(driverId), after === null ? undefined : lt(pools.seq, after)))
    .orderBy(desc(pools.seq))
    .limit(limit + 1);
  const page = toPage(rows, limit, (row) => row.seq);
  return { ...page, items: page.items.map(toTripSummary) };
}

const passengerColumns = {
  id: bookings.id,
  passengerName: users.name,
  pickupLat: bookings.pickupLat,
  pickupLng: bookings.pickupLng,
  pickupLabel: bookings.pickupLabel,
  destLat: bookings.destLat,
  destLng: bookings.destLng,
  destLabel: bookings.destLabel,
  seats: bookings.seats,
  rideOption: bookings.rideOption,
  paymentMethod: bookings.paymentMethod,
  estimatedFare: bookings.estimatedFare,
};

type PassengerRow = Pick<
  Booking,
  | 'id'
  | 'pickupLat'
  | 'pickupLng'
  | 'pickupLabel'
  | 'destLat'
  | 'destLng'
  | 'destLabel'
  | 'seats'
  | 'rideOption'
  | 'paymentMethod'
  | 'estimatedFare'
> & { passengerName: string };

function toPastTripBooking(
  row: PassengerRow,
  entry: Pick<PastTripBooking, 'outcome' | 'endedAt' | 'fare' | 'penaltyRecorded'>,
): PastTripBooking {
  return {
    id: row.id,
    passenger: { name: row.passengerName },
    pickup: { lat: row.pickupLat, lng: row.pickupLng, label: row.pickupLabel },
    destination: { lat: row.destLat, lng: row.destLng, label: row.destLabel },
    seats: row.seats,
    rideOption: row.rideOption,
    paymentMethod: row.paymentMethod,
    estimatedFare: row.estimatedFare,
    ...entry,
  };
}

// Why a cancelled booking was cancelled: the reason of its change to CANCELLED.
const cancelReason = sql<string | null>`(
  SELECT ${bookingStatusHistory.reason} FROM ${bookingStatusHistory}
  WHERE ${bookingStatusHistory.bookingId} = ${bookings.id}
    AND ${bookingStatusHistory.toStatus} = 'CANCELLED'
  ORDER BY ${bookingStatusHistory.createdAt} DESC, ${bookingStatusHistory.id} DESC
  LIMIT 1
)`;

function cancelOutcome(reason: string | null): TripOutcome {
  if (reason === 'late_cancel' || reason === 'no_show') return reason;
  return 'passenger_cancelled';
}

// One of the driver's finished trips with every passenger in it, in the order their part
// ended (FR-D15). Another driver's trip, or one still running, is "not found" (NFR-8).
export async function getPastTrip(
  db: Database,
  driverId: string,
  poolId: string,
): Promise<PastTrip> {
  const [trip] = await db
    .select({ ...tripColumns, vehicleName: vehicles.name })
    .from(pools)
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .where(and(eq(pools.id, poolId), ownFinishedTrips(driverId)));
  if (!trip) throw notFound();

  // The bookings the trip ended: completed, cancelled by the passenger, or no-shows.
  const ended = await db
    .select({
      ...passengerColumns,
      status: bookings.status,
      completedAt: bookings.completedAt,
      cancelledAt: bookings.cancelledAt,
      reason: cancelReason,
      fare: fareColumns,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.passengerId))
    .leftJoin(fares, eq(fares.bookingId, bookings.id))
    .where(and(eq(bookings.poolId, poolId), inArray(bookings.status, FINAL_STATUSES)));

  // The passengers the driver dropped. A penalty is written in the drop's transaction, so
  // it has the drop's time, which ties it to this drop even if the booking was dropped
  // more than once.
  const dropped = await db
    .select({
      ...passengerColumns,
      endedAt: bookingStatusHistory.createdAt,
      penaltyRecorded: sql<boolean>`EXISTS (
        SELECT 1 FROM ${driverPenalties}
        WHERE ${driverPenalties.driverId} = ${driverId}
          AND ${driverPenalties.bookingId} = ${bookingStatusHistory.bookingId}
          AND ${driverPenalties.createdAt} = ${bookingStatusHistory.createdAt}
      )`,
    })
    .from(bookingStatusHistory)
    .innerJoin(bookings, eq(bookings.id, bookingStatusHistory.bookingId))
    .innerJoin(users, eq(users.id, bookings.passengerId))
    .where(
      and(
        eq(bookingStatusHistory.poolId, poolId),
        eq(bookingStatusHistory.reason, 'driver_cancel'),
      ),
    )
    .orderBy(asc(bookingStatusHistory.createdAt));

  const entries = [
    ...ended.flatMap((row) => {
      const endedAt = row.completedAt ?? row.cancelledAt;
      // A finished trip's bookings have ended, so one of the two is set.
      if (!endedAt) return [];
      return [
        toPastTripBooking(row, {
          outcome: row.status === 'COMPLETED' ? 'completed' : cancelOutcome(row.reason),
          endedAt,
          fare: row.fare ? toFareBreakdown(row.fare) : null,
          penaltyRecorded: false,
        }),
      ];
    }),
    ...dropped.map((row) =>
      toPastTripBooking(row, {
        outcome: 'driver_cancelled',
        endedAt: row.endedAt,
        fare: null,
        penaltyRecorded: row.penaltyRecorded,
      }),
    ),
  ].sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime() || a.id.localeCompare(b.id));

  return { ...toTripSummary(trip), vehicle: { name: trip.vehicleName }, bookings: entries };
}

// The driver's earnings over all time: the stored final fare of every ride they completed,
// split by how it was paid (FR-D15). This is the source each trip's earnings come from, so
// the totals always equal the sum of the trips. Each of these fares was also settled into
// the ledger, as a cash earning or a TeslaPay credit, in the transaction that recorded it
// (FR-W4, FR-W5, FR-C7). Rides completed before the ledger existed have no entry there,
// and still count here. Fines and top-ups are never earnings.
export async function getEarnings(db: Database, driverId: string): Promise<Earnings> {
  const fare = fares.finalFare;
  const paidBy = (method: PaymentMethod) =>
    money(sql`sum(${fare}) FILTER (WHERE ${bookings.paymentMethod} = ${method})`);
  const [row] = await db
    .select({
      total: money(sql`sum(${fare})`),
      cash: paidBy('cash'),
      teslapay: paidBy('teslapay'),
      rides: sql<number>`count(*)`.mapWith(Number),
    })
    .from(fares)
    .innerJoin(bookings, eq(bookings.id, fares.bookingId))
    .innerJoin(pools, eq(pools.id, bookings.poolId))
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .where(and(eq(vehicles.driverId, driverId), eq(bookings.status, 'COMPLETED')));
  if (!row) throw new Error('An aggregate returned no row');
  return row;
}
