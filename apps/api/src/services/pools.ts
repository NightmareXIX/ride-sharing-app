import { and, asc, desc, eq, inArray, notExists, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../db/client.js';
import {
  bookings,
  bookingStatusHistory,
  fares,
  pools,
  users,
  vehicles,
} from '../db/schema/index.js';
import {
  ASSIGNED_STATUSES,
  isAssigned,
  type AssignedStatus,
  type BookingStatus,
  type PaymentMethod,
  type TransitionReason,
} from '../domain/booking.js';
import { isNearby, nextAction, type DispatchConfig, type NextAction } from '../domain/dispatch.js';
import { finalFare, type RideOption } from '../domain/fare.js';
import { fitsFreeSeats } from '../domain/seats.js';
import { AppError } from '../http/errors.js';
import type { Place } from './bookings.js';
import { getFare, type FareBreakdown } from './fares.js';
import { transitionBooking } from './transitions.js';

// One passenger in the driver's Tesla, as the driver sees them (FR-D14).
export interface TripBooking {
  id: string;
  passenger: { name: string };
  status: AssignedStatus;
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  directKm: string;
  estimatedFare: string;
  acceptedAt: Date;
  arrivedAt: Date | null;
  startedAt: Date | null;
  nextAction: NextAction;
}

// The driver's trip in progress, with the Tesla's seats as they stand.
export interface DriverTrip {
  id: string;
  createdAt: Date;
  seats: { capacity: number; taken: number };
  bookings: TripBooking[];
}

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'This ride was not found.');
}

function noVehicle(): AppError {
  return new AppError(404, 'NOT_FOUND', "You haven't registered a Tesla.");
}

// The Tesla's trip in progress, if any. There is at most one (pools_one_active_per_vehicle).
export async function activePoolId(
  db: Database | Transaction,
  vehicleId: string,
): Promise<string | null> {
  const [pool] = await db
    .select({ id: pools.id })
    .from(pools)
    .where(and(eq(pools.vehicleId, vehicleId), eq(pools.status, 'active')));
  return pool?.id ?? null;
}

// The driver's current trip with every passenger in it, or null (FR-D14).
export async function getDriverTrip(db: Database, driverId: string): Promise<DriverTrip | null> {
  const [found] = await db
    .select({
      id: pools.id,
      createdAt: pools.createdAt,
      capacity: vehicles.capacity,
      taken: vehicles.occupiedSeats,
    })
    .from(pools)
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .where(and(eq(vehicles.driverId, driverId), eq(pools.status, 'active')));
  if (!found) return null;
  const { capacity, taken, ...pool } = found;

  const rows = await db
    .select({
      id: bookings.id,
      passengerName: users.name,
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
      estimatedFare: bookings.estimatedFare,
      acceptedAt: bookings.acceptedAt,
      arrivedAt: bookings.arrivedAt,
      startedAt: bookings.startedAt,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.passengerId))
    .where(and(eq(bookings.poolId, pool.id), inArray(bookings.status, ASSIGNED_STATUSES)))
    .orderBy(asc(bookings.acceptedAt), asc(bookings.id));

  const trip = rows.flatMap((row): TripBooking[] => {
    const { status, acceptedAt } = row;
    // Only assigned bookings are selected, and those always have an accept time.
    if (!isAssigned(status) || !acceptedAt) return [];
    return [
      {
        id: row.id,
        passenger: { name: row.passengerName },
        status,
        pickup: { lat: row.pickupLat, lng: row.pickupLng, label: row.pickupLabel },
        destination: { lat: row.destLat, lng: row.destLng, label: row.destLabel },
        seats: row.seats,
        rideOption: row.rideOption,
        paymentMethod: row.paymentMethod,
        directKm: row.directKm,
        estimatedFare: row.estimatedFare,
        acceptedAt,
        arrivedAt: row.arrivedAt,
        startedAt: row.startedAt,
        nextAction: nextAction(status),
      },
    ];
  });
  return { ...pool, seats: { capacity, taken }, bookings: trip };
}

// What an accept is checked against: the Tesla and the request, read without locks. The
// commit applies only if the Tesla is still at `version` (FR-C3). Phase 5 plans the route
// from it, between the check and the commit, so no transaction waits on the map service.
export interface AcceptSnapshot {
  vehicleId: string;
  version: number;
  bookingId: string;
  seats: number;
}

async function readAccept(db: Database | Transaction, driverId: string, bookingId: string) {
  const [tesla] = await db
    .select({
      id: vehicles.id,
      capacity: vehicles.capacity,
      occupiedSeats: vehicles.occupiedSeats,
      version: vehicles.version,
      isOnline: vehicles.isOnline,
      lat: vehicles.currentLat,
      lng: vehicles.currentLng,
    })
    .from(vehicles)
    .where(eq(vehicles.driverId, driverId));
  if (!tesla) throw noVehicle();

  const [booking] = await db
    .select({
      status: bookings.status,
      poolId: bookings.poolId,
      seats: bookings.seats,
      pickupLat: bookings.pickupLat,
      pickupLng: bookings.pickupLng,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return { tesla, booking, currentPool: await activePoolId(db, tesla.id) };
}

type AcceptRead = Awaited<ReturnType<typeof readAccept>>;

// Whether this Tesla may take this request, judged from rows as they were read. 'repeat'
// means the driver already has it: a double tap or a retry (FR-C5, NFR-37). Anything that
// stands in the way is thrown.
function judgeAccept(
  { tesla, booking, currentPool }: AcceptRead,
  { searchRadiusKm }: DispatchConfig,
): 'repeat' | 'ok' {
  if (!tesla.isOnline || tesla.lat === null || tesla.lng === null) {
    throw new AppError(422, 'DRIVER_OFFLINE', 'Go online to accept rides.');
  }
  if (!booking) throw notFound();
  if (currentPool !== null && booking.poolId === currentPool) return 'repeat';

  if (booking.status === 'CANCELLED') {
    throw new AppError(409, 'INVALID_TRANSITION', 'This request was cancelled.');
  }
  if (booking.status === 'COMPLETED') {
    throw new AppError(409, 'INVALID_TRANSITION', 'This ride has already finished.');
  }
  if (booking.status !== 'REQUESTED') {
    throw new AppError(409, 'ALREADY_CLAIMED', 'Another driver took this ride.');
  }
  if (!fitsFreeSeats(tesla.capacity, tesla.occupiedSeats, booking.seats)) {
    throw new AppError(
      409,
      'SEATS_UNAVAILABLE',
      booking.seats > tesla.capacity
        ? "Your Tesla doesn't have enough seats."
        : 'Your Tesla has no free seat for this ride any more.',
    );
  }
  // Until the matching rule arrives (phase 5, FR-L3), a request joins a Tesla, busy or
  // not, when its pickup is in range. A Tesla with passengers can't move, so the range is
  // measured from where its trip began.
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
  if (!isNearby({ lat: tesla.lat, lng: tesla.lng }, pickup, searchRadiusKm)) {
    throw new AppError(422, 'NO_LONGER_MATCHES', 'This pickup is too far from your Tesla.');
  }
  return 'ok';
}

// Checks an accept without taking any lock. Null means the driver already has the ride.
export async function checkAccept(
  db: Database,
  driverId: string,
  bookingId: string,
  dispatch: DispatchConfig,
): Promise<AcceptSnapshot | null> {
  const read = await readAccept(db, driverId, bookingId);
  if (judgeAccept(read, dispatch) === 'repeat' || !read.booking) return null;
  return {
    vehicleId: read.tesla.id,
    version: read.tesla.version,
    bookingId,
    seats: read.booking.seats,
  };
}

// Claims the seats, then the request, in one transaction. The seat update is the claim: it
// applies only while the Tesla is online, unchanged since the check and has room, so of two
// accepts racing for the last seat exactly one gets a row back (FR-C1, FR-C3, FR-R3). It
// also locks the Tesla before the booking, the order every driver action uses (FR-C7).
export async function commitAccept(
  db: Database,
  driverId: string,
  snapshot: AcceptSnapshot,
  dispatch: DispatchConfig,
): Promise<void> {
  const { vehicleId, version, bookingId, seats } = snapshot;
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(vehicles)
      .set({
        occupiedSeats: sql`${vehicles.occupiedSeats} + ${seats}`,
        version: sql`${vehicles.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(vehicles.id, vehicleId),
          eq(vehicles.isOnline, true),
          eq(vehicles.version, version),
          sql`${vehicles.occupiedSeats} + ${seats} <= ${vehicles.capacity}`,
        ),
      )
      .returning({ id: vehicles.id });

    if (!claimed) {
      // Something changed since the check. Judge again from the rows as they are now, so the
      // driver hears why: another accept took the seats, the request went, and so on.
      if (judgeAccept(await readAccept(tx, driverId, bookingId), dispatch) === 'repeat') return;
      throw new AppError(409, 'POOL_CHANGED', 'Your trip changed while accepting. Try again.');
    }

    let poolId = await activePoolId(tx, vehicleId);
    if (poolId === null) {
      const [pool] = await tx.insert(pools).values({ vehicleId }).returning({ id: pools.id });
      if (!pool) throw new Error('Inserting the pool returned no row');
      poolId = pool.id;
    }

    // Only one driver's conditional update moves the request out of REQUESTED (FR-C2). A
    // loser throws, and the rollback gives back its seats and any trip it started.
    const outcome = await transitionBooking(tx, {
      bookingId,
      owner: sql`true`,
      from: ['REQUESTED'],
      to: 'ACCEPTED',
      actor: { id: driverId, role: 'driver' },
      reason: 'accepted',
      set: { poolId, acceptedAt: sql`now()` },
    });
    if (outcome.ok) return;
    if (outcome.current === null) throw notFound();
    if (outcome.current === 'CANCELLED') {
      throw new AppError(409, 'INVALID_TRANSITION', 'This request was cancelled.');
    }
    throw new AppError(409, 'ALREADY_CLAIMED', 'Another driver took this ride.');
  });
}

// The driver picks a request; nothing is auto-assigned (FR-D8). Everything is checked
// again, since the list the driver saw may be seconds old.
export async function acceptRequest(
  db: Database,
  driverId: string,
  bookingId: string,
  dispatch: DispatchConfig,
): Promise<DriverTrip | null> {
  const snapshot = await checkAccept(db, driverId, bookingId, dispatch);
  if (snapshot) await commitAccept(db, driverId, snapshot, dispatch);
  return getDriverTrip(db, driverId);
}

// Gives a booking's seats back to its Tesla, in the transaction that took the booking out
// of it (FR-R2). The CHECK refuses a count below zero.
export async function releaseSeats(
  tx: Transaction,
  vehicleId: string,
  seats: number,
): Promise<void> {
  await tx
    .update(vehicles)
    .set({
      occupiedSeats: sql`${vehicles.occupiedSeats} - ${seats}`,
      version: sql`${vehicles.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(vehicles.id, vehicleId));
}

// Ends the trip once none of its bookings is still with the driver (FR-R7). Runs in the
// transaction that made the last one final, or handed it back.
export async function finishPoolIfDone(tx: Transaction, poolId: string): Promise<void> {
  const stillAboard = tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.poolId, poolId), inArray(bookings.status, ASSIGNED_STATUSES)));
  await tx
    .update(pools)
    .set({ status: 'finished', finishedAt: sql`now()` })
    .where(and(eq(pools.id, poolId), eq(pools.status, 'active'), notExists(stillAboard)));
}

// Every driver action locks the Tesla first, then the booking (FR-C7).
async function lockTesla(tx: Transaction, driverId: string): Promise<string> {
  const [tesla] = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.driverId, driverId))
    .for('update');
  if (!tesla) throw noVehicle();
  return tesla.id;
}

// Bookings in this Tesla's trips. Anything else isn't the driver's: not found (NFR-8).
function inTripsOf(tx: Transaction, vehicleId: string): SQL {
  return inArray(
    bookings.poolId,
    tx.select({ id: pools.id }).from(pools).where(eq(pools.vehicleId, vehicleId)),
  );
}

interface TripStep {
  from: AssignedStatus;
  to: BookingStatus;
  reason: TransitionReason;
  set: PgUpdateSetSource<typeof bookings>;
}

// Each passenger's ride, one step at a time (FR §6, FR-D10).
const STEPS = {
  arrive: {
    from: 'ACCEPTED',
    to: 'DRIVER_ARRIVED',
    reason: 'driver_arrived',
    set: { arrivedAt: sql`now()` },
  },
  start: {
    from: 'DRIVER_ARRIVED',
    to: 'STARTED',
    reason: 'started',
    set: { startedAt: sql`now()` },
  },
  complete: {
    from: 'STARTED',
    to: 'COMPLETED',
    reason: 'completed',
    set: { completedAt: sql`now()` },
  },
} satisfies Record<NextAction, TripStep>;

function outOfStep(current: BookingStatus): AppError {
  const message =
    current === 'CANCELLED'
      ? 'This ride was cancelled.'
      : current === 'COMPLETED'
        ? 'This ride has already finished.'
        : 'Take the steps in order: arrive, start, then complete.';
  return new AppError(409, 'INVALID_TRANSITION', message);
}

// Moves one passenger a step along their ride. A repeat of a step that already happened
// changes nothing (NFR-37); a skipped step is refused (FR-R8). `andThen` runs in the same
// transaction, after the change.
async function takeStep(
  db: Database,
  driverId: string,
  bookingId: string,
  action: NextAction,
  andThen?: (tx: Transaction, done: StepDone) => Promise<void>,
): Promise<void> {
  const step: TripStep = STEPS[action];
  await db.transaction(async (tx) => {
    const vehicleId = await lockTesla(tx, driverId);
    const outcome = await transitionBooking(tx, {
      bookingId,
      owner: inTripsOf(tx, vehicleId),
      from: [step.from],
      to: step.to,
      actor: { id: driverId, role: 'driver' },
      reason: step.reason,
      set: step.set,
    });
    if (outcome.ok) {
      if (andThen && outcome.poolId) {
        await andThen(tx, { vehicleId, poolId: outcome.poolId, seats: outcome.seats });
      }
      return;
    }
    if (outcome.current === null) throw notFound();
    if (outcome.current !== step.to) throw outOfStep(outcome.current);
  });
}

// What a step's follow-up needs: the Tesla, the trip and the passenger's seats.
interface StepDone {
  vehicleId: string;
  poolId: string;
  seats: number;
}

export async function markArrived(
  db: Database,
  driverId: string,
  bookingId: string,
): Promise<DriverTrip | null> {
  await takeStep(db, driverId, bookingId, 'arrive');
  return getDriverTrip(db, driverId);
}

// The passenger is in the Tesla.
export async function startTrip(
  db: Database,
  driverId: string,
  bookingId: string,
): Promise<DriverTrip | null> {
  await takeStep(db, driverId, bookingId, 'start');
  return getDriverTrip(db, driverId);
}

export interface CompletedTrip {
  pool: DriverTrip | null;
  fare: FareBreakdown;
}

// The passenger is dropped off: the booking completes, its fare is recorded, its seats are
// freed and the trip ends if nobody else is aboard, all in one transaction (NFR-14). Cash is paid in person
// (FR-W5); ledger entries arrive in phase 6.
export async function completeTrip(
  db: Database,
  driverId: string,
  bookingId: string,
): Promise<CompletedTrip> {
  // The fare maths runs before the transaction, from values recorded at request time that
  // never change (NFR-41).
  const [booking] = await db
    .select({
      directKm: bookings.directKm,
      distanceMethod: bookings.distanceMethod,
      estimatedFare: bookings.estimatedFare,
      seats: bookings.seats,
      rideOption: bookings.rideOption,
    })
    .from(bookings)
    .innerJoin(pools, eq(pools.id, bookings.poolId))
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .where(and(eq(bookings.id, bookingId), eq(vehicles.driverId, driverId)));
  if (!booking) throw notFound();

  // A single ride's route is its pickup, then its destination: the odometer reads 0 at
  // pickup and the direct km at drop-off, with nobody to share with. Phase 5 takes the
  // readings from the pool's route stops instead.
  const pickupOdometerKm = '0.000';
  const dropoffOdometerKm = booking.directKm;
  const fare = finalFare(
    { directKm: booking.directKm, actualKm: dropoffOdometerKm, sharedKm: '0.000' },
    booking.seats,
    booking.rideOption,
  );

  await takeStep(db, driverId, bookingId, 'complete', async (tx, { vehicleId, poolId, seats }) => {
    await tx.insert(fares).values({
      bookingId,
      pickupOdometerKm,
      dropoffOdometerKm,
      actualKm: fare.actualKm,
      sharedKm: fare.sharedKm,
      directKm: booking.directKm,
      seats: booking.seats,
      seatMultiplier: fare.seatMultiplier,
      rideOption: booking.rideOption,
      optionMultiplier: fare.optionMultiplier,
      estimatedFare: booking.estimatedFare,
      computedFare: fare.computedFare,
      finalFare: fare.finalFare,
      distanceMethod: booking.distanceMethod,
    });
    await releaseSeats(tx, vehicleId, seats);
    await finishPoolIfDone(tx, poolId);
  });

  const stored = await getFare(db, bookingId);
  if (!stored) throw new Error(`Completed booking ${bookingId} has no fare`);
  return { pool: await getDriverTrip(db, driverId), fare: stored };
}

// Whether this driver's cancel is the latest thing to happen to the booking, so a second
// tap of Cancel can be answered as the first was.
async function cancelledLastBy(tx: Transaction, bookingId: string, driverId: string) {
  const [latest] = await tx
    .select({ reason: bookingStatusHistory.reason, actorId: bookingStatusHistory.actorId })
    .from(bookingStatusHistory)
    .where(eq(bookingStatusHistory.bookingId, bookingId))
    .orderBy(desc(bookingStatusHistory.createdAt), desc(bookingStatusHistory.id))
    .limit(1);
  return latest?.reason === 'driver_cancel' && latest.actorId === driverId;
}

// The driver drops a passenger before pickup (FR-D12). The request goes back to REQUESTED,
// visible to every driver again, and keeps its place in the queue. Its seats are freed, and
// the history keeps the pool it left. The penalty for a late cancel (FR-D13) arrives in phase 6.
export async function driverCancel(
  db: Database,
  driverId: string,
  bookingId: string,
): Promise<DriverTrip | null> {
  await db.transaction(async (tx) => {
    const vehicleId = await lockTesla(tx, driverId);
    const outcome = await transitionBooking(tx, {
      bookingId,
      owner: inTripsOf(tx, vehicleId),
      from: ['ACCEPTED', 'DRIVER_ARRIVED'],
      to: 'REQUESTED',
      actor: { id: driverId, role: 'driver' },
      reason: 'driver_cancel',
      set: { poolId: null, acceptedAt: null, arrivedAt: null },
    });
    if (outcome.ok) {
      await releaseSeats(tx, vehicleId, outcome.seats);
      if (outcome.poolId) await finishPoolIfDone(tx, outcome.poolId);
      return;
    }
    if (outcome.current === null) {
      // Already handed back by this driver: a second tap (NFR-37).
      if (await cancelledLastBy(tx, bookingId, driverId)) return;
      throw notFound();
    }
    if (outcome.current === 'STARTED') {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        'The passenger is already aboard. Complete the ride instead.',
      );
    }
    throw outOfStep(outcome.current);
  });
  return getDriverTrip(db, driverId);
}
