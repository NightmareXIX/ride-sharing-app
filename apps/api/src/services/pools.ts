import Big from 'big.js';
import { and, asc, desc, eq, inArray, isNull, notExists, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../db/client.js';
import {
  bookings,
  bookingStatusHistory,
  fares,
  pools,
  routeStops,
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
import { bestInsertion } from '../domain/matching.js';
import {
  planStops,
  sharedKm,
  type Aboard,
  type PlannedStop,
  type StopType,
} from '../domain/route.js';
import { fitsFreeSeats } from '../domain/seats.js';
import type { DistanceMethod, DistanceService } from '../geo/distance.js';
import type { LatLng } from '../geo/serviceArea.js';
import { AppError } from '../http/errors.js';
import type { Logger } from '../logger.js';
import type { Place } from './bookings.js';
import { getFare, type FareBreakdown } from './fares.js';
import {
  matchingRoute,
  progressOf,
  reachStop,
  readTripRoute,
  replanWithout,
  ROUTE_ATTEMPTS,
  StaleRoute,
  touchTesla,
  writePlan,
} from './routes.js';
import { transitionBooking } from './transitions.js';

// What the trip services need beyond the database: road distances to plan routes with.
export interface TripDeps {
  db: Database;
  distance: DistanceService;
}

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
  // Whether the next action can be taken now: it happens at the next stop.
  canAct: boolean;
}

// One stop on the driver's route, in order (FR-D14, FR-L5).
export interface TripStopView {
  id: string;
  bookingId: string;
  passenger: { name: string };
  type: StopType;
  place: Place;
  sequence: number;
  plannedOdometerKm: string;
  actualOdometerKm: string | null;
  reachedAt: Date | null;
  isNext: boolean;
}

// The driver's trip in progress: the Tesla's seats as they stand, and its route.
export interface DriverTrip {
  id: string;
  createdAt: Date;
  seats: { capacity: number; taken: number };
  // Km along the trip where the rest of the route is planned from.
  odometerKm: string;
  stops: TripStopView[];
  bookings: TripBooking[];
}

// The stop each step happens at.
const STEP_STOPS: Record<NextAction, StopType> = {
  arrive: 'pickup',
  start: 'pickup',
  complete: 'dropoff',
};

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'This ride was not found.');
}

function noVehicle(): AppError {
  return new AppError(404, 'NOT_FOUND', "You haven't registered a Tesla.");
}

// Where a Tesla with a trip stands. It went online to accept the trip, and can't move or
// go offline until the trip ends, so this is where the trip began.
function teslaLocation(lat: number | null, lng: number | null): LatLng {
  if (lat === null || lng === null) throw new Error('A Tesla with a trip has no location');
  return { lat, lng };
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

// The driver's current trip with every passenger and stop in it, or null (FR-D14).
export async function getDriverTrip(db: Database, driverId: string): Promise<DriverTrip | null> {
  const [found] = await db
    .select({
      id: pools.id,
      createdAt: pools.createdAt,
      capacity: vehicles.capacity,
      taken: vehicles.occupiedSeats,
      lat: vehicles.currentLat,
      lng: vehicles.currentLng,
    })
    .from(pools)
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .where(and(eq(vehicles.driverId, driverId), eq(pools.status, 'active')));
  if (!found) return null;
  const { capacity, taken, lat, lng, ...pool } = found;

  const route = await readTripRoute(db, pool.id, teslaLocation(lat, lng));
  const { anchor, next } = progressOf(route);
  const isNext = (bookingId: string, type: StopType) =>
    next?.bookingId === bookingId && next.type === type;

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
    const action = nextAction(status);
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
        nextAction: action,
        canAct: isNext(row.id, STEP_STOPS[action]),
      },
    ];
  });

  const stops = route.stops.map((stop): TripStopView => ({
    id: stop.id,
    bookingId: stop.bookingId,
    passenger: { name: stop.passengerName },
    type: stop.type,
    place: { ...stop.point, label: stop.label },
    sequence: stop.sequence,
    plannedOdometerKm: stop.plannedKm,
    actualOdometerKm: stop.reachedKm,
    reachedAt: stop.reachedAt,
    isNext: isNext(stop.bookingId, stop.type),
  }));
  return { ...pool, seats: { capacity, taken }, odometerKm: anchor.km, stops, bookings: trip };
}

// What an accept is checked against: the Tesla and the request, read without locks, and
// the route planned from them. The commit applies only if the Tesla is still at `version`
// (FR-C3), so the plan still holds; no transaction waits on the map service (NFR-2).
export interface AcceptSnapshot {
  vehicleId: string;
  version: number;
  bookingId: string;
  seats: number;
  // The trip's stops still to come, the new booking's among them.
  unreached: PlannedStop[];
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
      id: bookings.id,
      status: bookings.status,
      poolId: bookings.poolId,
      seats: bookings.seats,
      pickupLat: bookings.pickupLat,
      pickupLng: bookings.pickupLng,
      destLat: bookings.destLat,
      destLng: bookings.destLng,
      directKm: bookings.directKm,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return { tesla, booking, currentPool: await activePoolId(db, tesla.id) };
}

type AcceptRead = Awaited<ReturnType<typeof readAccept>>;

// Whether this Tesla may take this request, judged from rows as they were read. 'repeat'
// means the driver already has it: a double tap or a retry (FR-C5, NFR-37). Anything that
// stands in the way is thrown. Whether it fits the route is for the plan to say.
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
  // An idle Tesla takes requests near it (FR-D6). One with passengers takes those that fit
  // its route instead, which the plan decides (FR-L3).
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
  const here = { lat: tesla.lat, lng: tesla.lng };
  if (currentPool === null && !isNearby(here, pickup, searchRadiusKm)) {
    throw new AppError(422, 'NO_LONGER_MATCHES', 'This pickup is too far from your Tesla.');
  }
  return 'ok';
}

function noLongerFits(): AppError {
  return new AppError(422, 'NO_LONGER_MATCHES', 'This request no longer fits your route.');
}

// Where the request's stops go. An idle Tesla drives to the pickup, then the destination,
// counting km from where it stands. A Tesla with passengers fits them into its route by
// the matching rule (FR-L3), or can't take the request. At most one map request.
async function planAccept(
  { db, distance }: TripDeps,
  log: Logger,
  { tesla, booking, currentPool }: AcceptRead,
): Promise<PlannedStop[]> {
  if (!booking) throw notFound();
  const origin = teslaLocation(tesla.lat, tesla.lng);
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
  const destination = { lat: booking.destLat, lng: booking.destLng };

  if (currentPool === null) {
    const leg = await distance.legKm([origin, pickup, destination], log);
    if (!leg) throw noLongerFits();
    return planStops(
      { point: origin, km: '0.000' },
      [
        { bookingId: booking.id, type: 'pickup', point: pickup },
        { bookingId: booking.id, type: 'dropoff', point: destination },
      ],
      leg,
    );
  }

  const state = await readTripRoute(db, currentPool, origin);
  const route = matchingRoute(state);
  const onRoute = [route.anchor.point, ...route.pending.map((stop) => stop.point)];
  const leg = await distance.legKm([...onRoute, pickup, destination], log);
  if (!leg) throw noLongerFits();
  const match = bestInsertion(
    route,
    { bookingId: booking.id, pickup, destination, directKm: booking.directKm },
    leg,
  );
  if (!match.ok) {
    log.info({ bookingId: booking.id, reason: match.reason }, 'Request does not fit the route');
    throw noLongerFits();
  }
  const { pinned } = progressOf(state);
  return [...(pinned ? [pinned] : []), ...match.stops];
}

// Checks an accept and plans its route without taking any lock. Null means the driver
// already has the ride.
export async function checkAccept(
  deps: TripDeps,
  log: Logger,
  driverId: string,
  bookingId: string,
  dispatch: DispatchConfig,
): Promise<AcceptSnapshot | null> {
  const read = await readAccept(deps.db, driverId, bookingId);
  if (judgeAccept(read, dispatch) === 'repeat' || !read.booking) return null;
  return {
    vehicleId: read.tesla.id,
    version: read.tesla.version,
    bookingId,
    seats: read.booking.seats,
    unreached: await planAccept(deps, log, read),
  };
}

// Claims the seats, then the request, then writes the route, in one transaction. The seat
// update is the claim: it applies only while the Tesla is online, unchanged since the
// check and has room, so of two accepts racing for the last seat exactly one gets a row
// back (FR-C1, FR-C3, FR-R3). It also locks the Tesla before the booking, the order every
// driver action uses (FR-C7).
export async function commitAccept(
  db: Database,
  driverId: string,
  snapshot: AcceptSnapshot,
  dispatch: DispatchConfig,
): Promise<void> {
  const { vehicleId, version, bookingId, seats, unreached } = snapshot;
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
    if (outcome.ok) {
      await writePlan(tx, poolId, unreached);
      return;
    }
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
  deps: TripDeps,
  log: Logger,
  driverId: string,
  bookingId: string,
  dispatch: DispatchConfig,
): Promise<DriverTrip | null> {
  const snapshot = await checkAccept(deps, log, driverId, bookingId, dispatch);
  if (snapshot) await commitAccept(deps.db, driverId, snapshot, dispatch);
  return getDriverTrip(deps.db, driverId);
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

// Every driver action locks the Tesla first, then the booking (FR-C7). Work planned from
// an earlier version of the Tesla is stale: the trip changed since.
async function lockTesla(tx: Transaction, driverId: string, planned?: number): Promise<string> {
  const [tesla] = await tx
    .select({ id: vehicles.id, version: vehicles.version })
    .from(vehicles)
    .where(eq(vehicles.driverId, driverId))
    .for('update');
  if (!tesla) throw noVehicle();
  if (planned !== undefined && tesla.version !== planned) throw new StaleRoute();
  return tesla.id;
}

// Runs work planned outside a transaction, planning again from a fresh read if the trip
// changed in between (phase 5 LLD §3).
async function withFreshPlan(attempt: () => Promise<void>): Promise<void> {
  for (let tries = 1; ; tries += 1) {
    try {
      await attempt();
      return;
    } catch (err) {
      if (!(err instanceof StaleRoute)) throw err;
      if (tries >= ROUTE_ATTEMPTS) {
        throw new AppError(409, 'POOL_CHANGED', 'Your trip changed at the same moment. Try again.');
      }
    }
  }
}

// The driver follows the stops in order: a step happens at the next stop only.
async function assertNextStop(
  tx: Transaction,
  poolId: string,
  bookingId: string,
  type: StopType,
): Promise<void> {
  const [next] = await tx
    .select({
      bookingId: routeStops.bookingId,
      type: routeStops.type,
      name: users.name,
      pickupLabel: bookings.pickupLabel,
      destLabel: bookings.destLabel,
    })
    .from(routeStops)
    .innerJoin(bookings, eq(bookings.id, routeStops.bookingId))
    .innerJoin(users, eq(users.id, bookings.passengerId))
    .where(and(eq(routeStops.poolId, poolId), isNull(routeStops.reachedAt)))
    .orderBy(asc(routeStops.sequence))
    .limit(1);
  if (!next) throw new Error(`Trip ${poolId} has a passenger but no stops`);
  if (next.bookingId === bookingId && next.type === type) return;
  const message =
    next.type === 'pickup'
      ? `Pick up ${next.name} at ${next.pickupLabel} first.`
      : `Drop off ${next.name} at ${next.destLabel} first.`;
  throw new AppError(409, 'OUT_OF_STOP_ORDER', message);
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

// What a step's follow-up needs: the Tesla, the trip and the passenger's seats.
interface StepDone {
  vehicleId: string;
  poolId: string;
  seats: number;
}

interface StepOptions {
  // The Tesla's version the caller planned from; the step is stale if it has moved.
  planned?: number;
  // Runs in the same transaction, after the change.
  andThen?: (tx: Transaction, done: StepDone) => Promise<void>;
}

// Moves one passenger a step along their ride, at the next stop only. A repeat of a step
// that already happened changes nothing (NFR-37); a skipped step is refused (FR-R8).
// Starting and completing record the stop's reading (FR §6).
async function takeStep(
  db: Database,
  driverId: string,
  bookingId: string,
  action: NextAction,
  { planned, andThen }: StepOptions = {},
): Promise<void> {
  const step: TripStep = STEPS[action];
  const stop = STEP_STOPS[action];
  await db.transaction(async (tx) => {
    const vehicleId = await lockTesla(tx, driverId, planned);
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
      if (!outcome.poolId) throw new Error(`Booking ${bookingId} took a step outside a trip`);
      await assertNextStop(tx, outcome.poolId, bookingId, stop);
      if (action !== 'arrive') await reachStop(tx, bookingId, stop);
      // The route now goes on from somewhere else (FR-C3). Completing frees seats, which
      // bumps the version too.
      if (action !== 'complete') await touchTesla(tx, vehicleId);
      await andThen?.(tx, { vehicleId, poolId: outcome.poolId, seats: outcome.seats });
      return;
    }
    if (outcome.current === null) throw notFound();
    if (outcome.current !== step.to) throw outOfStep(outcome.current);
  });
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

// A drop-off priced before the transaction, from the Tesla at `version`.
interface PricedDropOff {
  version: number;
  // Null unless the passenger is aboard: there is nothing to price, and the step says why.
  fare: typeof fares.$inferInsert | null;
}

// Prices a drop-off from the route (FR-F4, FR-F5): the pickup's reading, the drop-off's
// planned km, and the km anyone else was aboard. Every stop before the drop-off has been
// reached, so these are recorded readings; a passenger still aboard shares up to here.
async function priceDropOff(
  db: Database,
  driverId: string,
  bookingId: string,
): Promise<PricedDropOff> {
  const [booking] = await db
    .select({
      status: bookings.status,
      poolId: bookings.poolId,
      directKm: bookings.directKm,
      distanceMethod: bookings.distanceMethod,
      estimatedFare: bookings.estimatedFare,
      seats: bookings.seats,
      rideOption: bookings.rideOption,
      version: vehicles.version,
      lat: vehicles.currentLat,
      lng: vehicles.currentLng,
    })
    .from(bookings)
    .innerJoin(pools, eq(pools.id, bookings.poolId))
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .where(and(eq(bookings.id, bookingId), eq(vehicles.driverId, driverId)));
  if (!booking) throw notFound();
  const { version, poolId } = booking;
  if (booking.status !== 'STARTED' || !poolId) return { version, fare: null };

  const route = await readTripRoute(db, poolId, teslaLocation(booking.lat, booking.lng));
  const stopOf = (id: string, type: StopType) =>
    route.stops.find((stop) => stop.bookingId === id && stop.type === type);
  const pickup = stopOf(bookingId, 'pickup');
  const dropoff = stopOf(bookingId, 'dropoff');
  if (!pickup?.reachedKm || !dropoff) throw new Error(`Booking ${bookingId} has no route`);

  const ride: Aboard = { from: pickup.reachedKm, to: dropoff.plannedKm };
  const others = [...route.bookings.keys()]
    .filter((id) => id !== bookingId)
    .flatMap((id): Aboard[] => {
      const from = stopOf(id, 'pickup')?.reachedKm;
      return from ? [{ from, to: stopOf(id, 'dropoff')?.reachedKm ?? ride.to }] : [];
    });
  // The legs of this ride: into every stop after the pickup, up to the drop-off.
  const legs = route.stops.filter(
    (stop) => stop.sequence > pickup.sequence && stop.sequence <= dropoff.sequence,
  );
  const routeDistanceMethod: DistanceMethod = legs.some((stop) => stop.method === 'fallback')
    ? 'fallback'
    : 'routed';

  const fare = finalFare(
    {
      directKm: booking.directKm,
      actualKm: new Big(ride.to).minus(ride.from).toFixed(3),
      sharedKm: sharedKm(ride, others),
    },
    booking.seats,
    booking.rideOption,
  );
  return {
    version,
    fare: {
      bookingId,
      pickupOdometerKm: ride.from,
      dropoffOdometerKm: ride.to,
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
      routeDistanceMethod,
    },
  };
}

// The passenger is dropped off: the booking completes, the stop's reading and the fare are
// recorded, the seats are freed and the trip ends if nobody else is aboard, all in one
// transaction (NFR-14). Cash is paid in person (FR-W5); ledger entries arrive in phase 6.
export async function completeTrip(
  db: Database,
  driverId: string,
  bookingId: string,
): Promise<CompletedTrip> {
  await withFreshPlan(async () => {
    // The fare maths runs before the transaction, from readings that never change (NFR-41).
    const { version, fare } = await priceDropOff(db, driverId, bookingId);
    await takeStep(db, driverId, bookingId, 'complete', {
      planned: version,
      andThen: async (tx, { vehicleId, poolId, seats }) => {
        if (!fare) throw new StaleRoute();
        await tx.insert(fares).values(fare);
        await releaseSeats(tx, vehicleId, seats);
        await finishPoolIfDone(tx, poolId);
      },
    });
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

// The route once the booking leaves this driver's trip, planned before the transaction.
// `unreached` is null when the booking isn't waiting for this driver: the step says why.
async function planLeaving(
  { db, distance }: TripDeps,
  log: Logger,
  driverId: string,
  bookingId: string,
): Promise<{ version: number; unreached: PlannedStop[] | null }> {
  const [tesla] = await db
    .select({
      id: vehicles.id,
      version: vehicles.version,
      lat: vehicles.currentLat,
      lng: vehicles.currentLng,
    })
    .from(vehicles)
    .where(eq(vehicles.driverId, driverId));
  if (!tesla) throw noVehicle();
  const [booking] = await db
    .select({ status: bookings.status, poolId: bookings.poolId })
    .from(bookings)
    .innerJoin(pools, eq(pools.id, bookings.poolId))
    .where(
      and(eq(bookings.id, bookingId), eq(pools.vehicleId, tesla.id), eq(pools.status, 'active')),
    );
  const waiting = booking?.status === 'ACCEPTED' || booking?.status === 'DRIVER_ARRIVED';
  if (!booking?.poolId || !waiting) return { version: tesla.version, unreached: null };

  const route = await readTripRoute(db, booking.poolId, teslaLocation(tesla.lat, tesla.lng));
  return {
    version: tesla.version,
    unreached: await replanWithout(route, bookingId, distance, log),
  };
}

// The driver drops a passenger before pickup (FR-D12). The request goes back to REQUESTED,
// visible to every driver again, and keeps its place in the queue. Its seats are freed,
// its stops leave the route and the rest is re-planned, and the history keeps the pool it
// left. The penalty for a late cancel (FR-D13) arrives in phase 6.
export async function driverCancel(
  deps: TripDeps,
  log: Logger,
  driverId: string,
  bookingId: string,
): Promise<DriverTrip | null> {
  const { db } = deps;
  await withFreshPlan(async () => {
    const { version, unreached } = await planLeaving(deps, log, driverId, bookingId);
    await db.transaction(async (tx) => {
      const vehicleId = await lockTesla(tx, driverId, version);
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
        if (!outcome.poolId || !unreached) throw new StaleRoute();
        await releaseSeats(tx, vehicleId, outcome.seats);
        await writePlan(tx, outcome.poolId, unreached);
        await finishPoolIfDone(tx, outcome.poolId);
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
  });
  return getDriverTrip(db, driverId);
}
