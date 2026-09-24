import Big from 'big.js';
import { and, eq, max, notInArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import {
  bookings,
  bookingStatusHistory,
  vehicles,
  wallets,
  type Booking,
} from '../db/schema/index.js';
import { FINAL_STATUSES, type BookingStatus, type PaymentMethod } from '../domain/booking.js';
import { estimateFare, type FareEstimate, type RideOption } from '../domain/fare.js';
import type { DistanceMethod, DistanceService } from '../geo/distance.js';
import type { LatLng } from '../geo/serviceArea.js';
import { AppError } from '../http/errors.js';
import type { Logger } from '../logger.js';

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

// What a passenger sees about their own booking. It never names or prices anyone else
// (FR-P8, NFR-9).
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
  cancelledAt: Date | null;
}

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
  cancelledAt: bookings.cancelledAt,
};

type BookingRow = Pick<Booking, keyof typeof bookingColumns>;

export function toBookingView(row: BookingRow): BookingView {
  const { pickupLat, pickupLng, pickupLabel, destLat, destLng, destLabel, ...rest } = row;
  return {
    ...rest,
    pickup: { lat: pickupLat, lng: pickupLng, label: pickupLabel },
    destination: { lat: destLat, lng: destLng, label: destLabel },
  };
}

// Selects the booking body, so every route returns the same shape.
export function selectBooking(db: Database) {
  return db.select(bookingColumns).from(bookings);
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
        .returning(bookingColumns);
      if (!row) throw new Error('Inserting the booking returned no row');

      await tx.insert(bookingStatusHistory).values({
        bookingId: row.id,
        fromStatus: null,
        toStatus: 'REQUESTED',
        actorId: passengerId,
        reason: 'requested',
      });
      return toBookingView(row);
    });
    return { booking, created: true };
  } catch (err) {
    // Another tap got there first. The unique index decides, not the lookup above.
    if (!isUniqueViolation(err, 'bookings_one_active_per_passenger')) throw err;
    const winner = await getCurrentBooking(db, passengerId);
    if (!winner) throw err;
    return { booking: repeatOrConflict(winner, input), created: false };
  }
}
