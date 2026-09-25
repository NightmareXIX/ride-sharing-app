import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client.js';
import { bookings, routeStops, users, vehicles } from '../db/schema/index.js';
import type { BookingStatus } from '../domain/booking.js';
import type { TripRoute } from '../domain/matching.js';
import {
  planStops,
  routeProgress,
  type PlannedStop,
  type RouteProgress,
  type StopType,
  type TripStop,
} from '../domain/route.js';
import type { DistanceService } from '../geo/distance.js';
import type { LatLng } from '../geo/serviceArea.js';
import type { Logger } from '../logger.js';

// A trip's route as the database holds it (phase 5 LLD §3).

export interface StoredStop extends TripStop {
  id: string;
  sequence: number;
  reachedAt: Date | null;
  passengerName: string;
  label: string;
}

// What a trip's route is planned from: its stops, and the bookings they belong to.
export interface TripRouteState {
  poolId: string;
  // Where the Tesla began the trip; it can't move while it has passengers.
  origin: LatLng;
  stops: StoredStop[];
  // Each booking with a stop in the trip: its status and direct km.
  bookings: Map<string, { status: BookingStatus; directKm: string }>;
}

export async function readTripRoute(
  db: Database | Transaction,
  poolId: string,
  origin: LatLng,
): Promise<TripRouteState> {
  const rows = await db
    .select({
      id: routeStops.id,
      bookingId: routeStops.bookingId,
      type: routeStops.type,
      sequence: routeStops.sequence,
      lat: routeStops.lat,
      lng: routeStops.lng,
      plannedKm: routeStops.plannedOdometerKm,
      reachedKm: routeStops.actualOdometerKm,
      reachedAt: routeStops.reachedAt,
      method: routeStops.distanceMethod,
      status: bookings.status,
      directKm: bookings.directKm,
      passengerName: users.name,
      pickupLabel: bookings.pickupLabel,
      destLabel: bookings.destLabel,
    })
    .from(routeStops)
    .innerJoin(bookings, eq(bookings.id, routeStops.bookingId))
    .innerJoin(users, eq(users.id, bookings.passengerId))
    .where(eq(routeStops.poolId, poolId))
    .orderBy(asc(routeStops.sequence));

  const tripBookings = new Map<string, { status: BookingStatus; directKm: string }>();
  const stops = rows.map((row): StoredStop => {
    tripBookings.set(row.bookingId, { status: row.status, directKm: row.directKm });
    return {
      id: row.id,
      bookingId: row.bookingId,
      type: row.type,
      sequence: row.sequence,
      point: { lat: row.lat, lng: row.lng },
      plannedKm: row.plannedKm,
      reachedKm: row.reachedKm,
      reachedAt: row.reachedAt,
      method: row.method,
      passengerName: row.passengerName,
      label: row.type === 'pickup' ? row.pickupLabel : row.destLabel,
    };
  });
  return { poolId, origin, stops, bookings: tripBookings };
}

// Where the driver is on the route. A passenger the driver is waiting for has their
// pickup pinned as the next stop.
export function progressOf(state: TripRouteState, leaving?: string): RouteProgress {
  const stops = state.stops.filter((stop) => stop.bookingId !== leaving);
  return routeProgress(
    stops,
    state.origin,
    (bookingId) => state.bookings.get(bookingId)?.status === 'DRIVER_ARRIVED',
  );
}

// The trip as the matching rule sees it (FR-L3).
export function matchingRoute(state: TripRouteState): TripRoute {
  const progress = progressOf(state);
  const reading = (bookingId: string, type: StopType) =>
    state.stops.find((stop) => stop.bookingId === bookingId && stop.type === type)?.reachedKm ??
    null;
  return {
    anchor: progress.anchor,
    pending: progress.pending,
    bookings: [...state.bookings].map(([id, { directKm }]) => ({
      id,
      directKm,
      // The pickup the driver waits at is fixed too: nothing goes before it.
      pickupKm:
        reading(id, 'pickup') ?? (progress.pinned?.bookingId === id ? progress.anchor.km : null),
      dropoffKm: reading(id, 'dropoff'),
    })),
  };
}

// The stops still to come once a booking leaves: the rest keep their order and get new
// km from where the route is planned from (Core Entities §3). Measured before any
// transaction opens, so it never waits on the map service with a lock held (NFR-2).
export async function replanWithout(
  state: TripRouteState,
  bookingId: string,
  distance: DistanceService,
  log: Logger,
): Promise<PlannedStop[]> {
  const { anchor, pinned, pending } = progressOf(state, bookingId);
  const leg = await distance.legKm([anchor.point, ...pending.map((stop) => stop.point)], log);
  if (!leg) throw new Error('Re-planning a route has no map budget to run out of');
  return [...(pinned ? [pinned] : []), ...planStops(anchor, pending, leg)];
}

// Replaces the stops still to come with a new plan. Reached stops never change (NFR-41);
// the new ones are numbered after them.
export async function writePlan(
  tx: Transaction,
  poolId: string,
  unreached: readonly PlannedStop[],
): Promise<void> {
  await tx
    .delete(routeStops)
    .where(and(eq(routeStops.poolId, poolId), isNull(routeStops.reachedAt)));
  if (unreached.length === 0) return;

  const [last] = await tx
    .select({ sequence: sql<number>`coalesce(max(${routeStops.sequence}), 0)`.mapWith(Number) })
    .from(routeStops)
    .where(eq(routeStops.poolId, poolId));
  const after = last?.sequence ?? 0;
  await tx.insert(routeStops).values(
    unreached.map((stop, i) => ({
      poolId,
      bookingId: stop.bookingId,
      type: stop.type,
      sequence: after + i + 1,
      lat: stop.point.lat,
      lng: stop.point.lng,
      plannedOdometerKm: stop.plannedKm,
      distanceMethod: stop.method,
    })),
  );
}

// The driver got to the stop: its planned km becomes its reading, which never changes
// again (FR-L5, NFR-41). No distance is measured now.
export async function reachStop(tx: Transaction, bookingId: string, type: StopType): Promise<void> {
  await tx
    .update(routeStops)
    .set({ actualOdometerKm: sql`${routeStops.plannedOdometerKm}`, reachedAt: sql`now()` })
    .where(
      and(
        eq(routeStops.bookingId, bookingId),
        eq(routeStops.type, type),
        isNull(routeStops.reachedAt),
      ),
    );
}

// The route changed, so an accept planned against it is out of date (FR-C3).
export async function touchTesla(tx: Transaction, vehicleId: string): Promise<void> {
  await tx
    .update(vehicles)
    .set({ version: sql`${vehicles.version} + 1`, updatedAt: sql`now()` })
    .where(eq(vehicles.id, vehicleId));
}

// Work planned from a snapshot of the trip was overtaken by another change to it.
export class StaleRoute extends Error {
  constructor() {
    super('The trip changed after it was read');
  }
}

// Plans outside the transaction, commits inside it if the Tesla is still as it was, and
// starts again from a fresh snapshot otherwise, a few times at most.
export const ROUTE_ATTEMPTS = 3;
