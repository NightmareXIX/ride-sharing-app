import Big from 'big.js';
import { and, eq, max, notInArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import {
  bookings,
  bookingStatusHistory,
  fares,
  pools,
  users,
  vehicles,
  wallets,
} from '../db/schema/index.js';
import {
  FINAL_STATUSES,
  FREE_CANCEL_WINDOW,
  isAssigned,
  type BookingStatus,
  type PaymentMethod,
} from '../domain/booking.js';
import { estimateFare, type FareEstimate, type RideOption } from '../domain/fare.js';
import type { DistanceMethod, DistanceService } from '../geo/distance.js';
import type { LatLng } from '../geo/serviceArea.js';
import { AppError } from '../http/errors.js';
import type { Logger } from '../logger.js';
import { fareColumns, toFareBreakdown, type FareBreakdown } from './fares.js';
import { finishPoolIfDone, releaseSeats } from './pools.js';
import { transitionBooking } from './transitions.js';

export interface RideDeps {
  db: Database;
  distance: DistanceService;
}

export interface Place extends LatLng {
  label: string;
}

export interface TripInput {
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
}

export interface RideRequestInput extends TripInput {
  paymentMethod: PaymentMethod;
}

export interface Quote extends FareEstimate {
  distanceMethod: DistanceMethod;
}

// Shown while the booking waits again because its driver cancelled (FR-D12).
export type BookingNotice = 'driver_cancelled';

// What a passenger sees about their own booking: their driver and Tesla once accepted,
// and their fare once completed. It never names or prices another passenger (FR-P8, NFR-9).
export interface BookingView {
  id: string;
  status: BookingStatus;
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  directKm: string;
  distanceMethod: DistanceMethod;
  estimatedFare: string;
  requestedAt: Date;
  acceptedAt: Date | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  // Until then, cancelling after acceptance is free (FR-P7). Set by the database clock.
  freeCancelUntil: Date | null;
  driver: { name: string } | null;
  vehicle: { name: string } | null;
  notice: BookingNotice | null;
  fare: FareBreakdown | null;
}

const drivers = alias(users, 'drivers');

// Why the booking last changed, from its history.
const latestReason = sql<string | null>`(
  SELECT ${bookingStatusHistory.reason} FROM ${bookingStatusHistory}
  WHERE ${bookingStatusHistory.bookingId} = ${bookings.id}
  ORDER BY ${bookingStatusHistory.createdAt} DESC, ${bookingStatusHistory.id} DESC
  LIMIT 1
)`;

const freeCancelWindow = sql.raw(`interval '${FREE_CANCEL_WINDOW}'`);

const bookingColumns = {
  id: bookings.id,
  status: bookings.status,
  pickupLat: bookings.pickupLat,
  pickupLng: bookings.pickupLng,
  pickupLabel: bookings.pickupLabel,
  destLat: bookings.destLat,
  destLng: bookings.destLng,
  destLabel: bookings.destLabel,
  seats: bookings.seats,
  rideOption: bookings.rideOption,
  paymentMethod: bookings.paymentMethod,
  directKm: bookings.directKm,
  distanceMethod: bookings.distanceMethod,
  estimatedFare: bookings.estimatedFare,
  requestedAt: bookings.requestedAt,
  acceptedAt: bookings.acceptedAt,
  arrivedAt: bookings.arrivedAt,
  startedAt: bookings.startedAt,
  completedAt: bookings.completedAt,
  cancelledAt: bookings.cancelledAt,
  freeCancelUntil: sql<Date | null>`${bookings.acceptedAt} + ${freeCancelWindow}`.mapWith(
    bookings.acceptedAt,
  ),
  driverName: drivers.name,
  vehicleName: vehicles.name,
  latestReason,
  fare: fareColumns,
};

// Selects the booking body, so every route returns the same shape.
export function selectBooking(db: Database) {
  return db
    .select(bookingColumns)
    .from(bookings)
    .leftJoin(pools, eq(pools.id, bookings.poolId))
    .leftJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .leftJoin(drivers, eq(drivers.id, vehicles.driverId))
    .leftJoin(fares, eq(fares.bookingId, bookings.id));
}

type BookingRow = Awaited<ReturnType<typeof selectBooking>>[number];

export function toBookingView(row: BookingRow): BookingView {
  const { pickupLat, pickupLng, pickupLabel, destLat, destLng, destLabel, ...rest } = row;
  const { driverName, vehicleName, latestReason: reason, fare, ...details } = rest;
  return {
    ...details,
    pickup: { lat: pickupLat, lng: pickupLng, label: pickupLabel },
    destination: { lat: destLat, lng: destLng, label: destLabel },
    driver: driverName === null ? null : { name: driverName },
    vehicle: vehicleName === null ? null : { name: vehicleName },
    notice: row.status === 'REQUESTED' && reason === 'driver_cancel' ? 'driver_cancelled' : null,
    fare: fare ? toFareBreakdown(fare) : null,
  };
}

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'This ride was not found.');
}

// A request no Tesla could carry would wait forever, so it is refused up front.
async function assertSomeTeslaFits(db: Database, seats: number): Promise<void> {
  const [row] = await db.select({ largest: max(vehicles.capacity) }).from(vehicles);
  const largest = row?.largest ?? null;
  if (largest !== null && seats <= largest) return;
  throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are missing or invalid.', [
    {
      path: 'seats',
      message:
        largest === null ? 'no Tesla is registered yet' : `no Tesla has more than ${largest} seats`,
    },
  ]);
}

// The road distance and fare estimate for a trip (FR-P4). Runs before any transaction
// opens, so a slow map service never holds a database connection.
export async function quoteTrip(
  { db, distance }: RideDeps,
  log: Logger,
  trip: TripInput,
): Promise<Quote> {
  await assertSomeTeslaFits(db, trip.seats);
  const road = await distance.roadKm(trip.pickup, trip.destination, log);
  return {
    ...estimateFare(road.km, trip.seats, trip.rideOption),
    distanceMethod: road.method,
  };
}

// The passenger's booking that hasn't finished yet, if any. There is at most one.
export async function getCurrentBooking(
  db: Database,
  passengerId: string,
): Promise<BookingView | null> {
  const [row] = await selectBooking(db).where(
    and(eq(bookings.passengerId, passengerId), notInArray(bookings.status, FINAL_STATUSES)),
  );
  return row ? toBookingView(row) : null;
}

// Someone else's booking is "not found", never "forbidden" (FR-P9, NFR-8).
export async function getBooking(
  db: Database,
  passengerId: string,
  bookingId: string,
): Promise<BookingView> {
  const [row] = await selectBooking(db).where(
    and(eq(bookings.id, bookingId), eq(bookings.passengerId, passengerId)),
  );
  if (!row) throw notFound();
  return toBookingView(row);
}

function samePlace(a: Place, b: Place): boolean {
  return a.lat === b.lat && a.lng === b.lng && a.label === b.label;
}

// A second tap of the same Request button, rather than a different ride.
function isRepeatOf(active: BookingView, input: RideRequestInput): boolean {
  return (
    active.status === 'REQUESTED' &&
    samePlace(active.pickup, input.pickup) &&
    samePlace(active.destination, input.destination) &&
    active.seats === input.seats &&
    active.rideOption === input.rideOption &&
    active.paymentMethod === input.paymentMethod
  );
}

// A repeat of the active request returns it; anything else is refused (FR-P10, NFR-37).
function repeatOrConflict(active: BookingView, input: RideRequestInput): BookingView {
  if (isRepeatOf(active, input)) return active;
  throw new AppError(409, 'ACTIVE_BOOKING_EXISTS', 'You already have a ride in progress.');
}

async function walletBalance(db: Database, userId: string): Promise<Big> {
  const [wallet] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  if (!wallet) throw new Error(`User ${userId} has no wallet`);
  return new Big(wallet.balance);
}

export interface RideRequestResult {
  booking: BookingView;
  // False when the request repeated one that already exists.
  created: boolean;
}

// Creates a ride request (FR-P3). The distance and fare are worked out before the
// transaction; the booking and its first history row are written together (FR-R11).
export async function requestRide(
  deps: RideDeps,
  log: Logger,
  passengerId: string,
  input: RideRequestInput,
): Promise<RideRequestResult> {
  const { db } = deps;

  // Answers a double tap without asking the map service again.
  const active = await getCurrentBooking(db, passengerId);
  if (active) return { booking: repeatOrConflict(active, input), created: false };

  const balance = await walletBalance(db, passengerId);
  if (balance.lt(0)) {
    throw new AppError(
      422,
      'NEGATIVE_BALANCE',
      'Your balance is below zero. Top up before requesting a ride.',
    );
  }

  const quote = await quoteTrip(deps, log, input);
  if (input.paymentMethod === 'teslapay' && balance.lt(quote.estimatedFare)) {
    throw new AppError(
      422,
      'INSUFFICIENT_BALANCE',
      'Your TeslaPay balance is too low for this ride. Choose Cash or top up.',
    );
  }

  try {
    const booking = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(bookings)
        .values({
          passengerId,
          pickupLat: input.pickup.lat,
          pickupLng: input.pickup.lng,
          pickupLabel: input.pickup.label,
          destLat: input.destination.lat,
          destLng: input.destination.lng,
          destLabel: input.destination.label,
          seats: input.seats,
          rideOption: input.rideOption,
          paymentMethod: input.paymentMethod,
          directKm: quote.directKm,
          distanceMethod: quote.distanceMethod,
          estimatedFare: quote.estimatedFare,
        })
        .returning({ id: bookings.id });
      if (!row) throw new Error('Inserting the booking returned no row');

      await tx.insert(bookingStatusHistory).values({
        bookingId: row.id,
        fromStatus: null,
        toStatus: 'REQUESTED',
        actorId: passengerId,
        reason: 'requested',
      });
      return row.id;
    });
    return { booking: await getBooking(db, passengerId, booking), created: true };
  } catch (err) {
    // Another tap got there first. The unique index decides, not the lookup above.
    if (!isUniqueViolation(err, 'bookings_one_active_per_passenger')) throw err;
    const winner = await getCurrentBooking(db, passengerId);
    if (!winner) throw err;
    return { booking: repeatOrConflict(winner, input), created: false };
  }
}

// The Tesla carrying the booking now, if a driver has it.
async function teslaOf(tx: Transaction, bookingId: string, owner: SQL): Promise<string | null> {
  const [row] = await tx
    .select({ vehicleId: pools.vehicleId })
    .from(bookings)
    .innerJoin(pools, eq(pools.id, bookings.poolId))
    .where(and(eq(bookings.id, bookingId), owner));
  return row?.vehicleId ?? null;
}

// A booking can change Tesla between finding it and locking it only if a driver hands it
// back and another accepts it at that moment; trying again is enough.
const CANCEL_ATTEMPTS = 3;

// A passenger cancels any time before the trip starts (FR-P7). It is free while waiting
// and for 3 minutes after acceptance; later it is recorded as a late cancel, measured by
// the database clock (FR-R9, NFR-38). Phase 6 adds the fine. Pressing Cancel twice is
// harmless (NFR-37).
export async function cancelRide(
  db: Database,
  passengerId: string,
  bookingId: string,
): Promise<BookingView> {
  const owner = eq(bookings.passengerId, passengerId);
  const cancelOnce = () =>
    db.transaction(async (tx) => {
      // The Tesla is locked before the booking, the order every driver action uses, so a
      // cancel and a driver action can't deadlock (FR-C7).
      const vehicleId = await teslaOf(tx, bookingId, owner);
      if (vehicleId) {
        await tx
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(eq(vehicles.id, vehicleId))
          .for('update');
      }

      const [timing] = await tx
        .select({
          late: sql<boolean>`coalesce(now() > ${bookings.acceptedAt} + ${freeCancelWindow}, false)`,
        })
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), owner))
        .for('update');
      const holder = await teslaOf(tx, bookingId, owner);
      if (holder !== null && holder !== vehicleId) return 'moved' as const;

      const result = await transitionBooking(tx, {
        bookingId,
        owner,
        from: ['REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED'],
        to: 'CANCELLED',
        actor: { id: passengerId, role: 'passenger' },
        reason: timing?.late ? 'late_cancel' : 'passenger_cancel',
        set: { cancelledAt: sql`now()` },
      });
      if (result.ok && holder !== null && isAssigned(result.from)) {
        await releaseSeats(tx, holder, result.seats);
      }
      // The driver's trip ends if this was its only passenger (FR-R7).
      if (result.ok && result.poolId) await finishPoolIfDone(tx, result.poolId);
      return result;
    });

  let outcome = await cancelOnce();
  for (let attempt = 1; outcome === 'moved' && attempt < CANCEL_ATTEMPTS; attempt += 1) {
    outcome = await cancelOnce();
  }
  if (outcome === 'moved') throw new Error(`Booking ${bookingId} kept changing Tesla`);

  if (outcome.ok || outcome.current === 'CANCELLED') {
    return getBooking(db, passengerId, bookingId);
  }
  if (outcome.current === null) throw notFound();
  throw new AppError(
    409,
    'INVALID_TRANSITION',
    outcome.current === 'COMPLETED'
      ? 'This ride has already finished.'
      : 'Your ride has started, so it can no longer be cancelled.',
  );
}
