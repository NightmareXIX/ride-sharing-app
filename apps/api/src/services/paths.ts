import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { bookings, pools, vehicles } from '../db/schema/index.js';
import type { PathLeg, PathService } from '../geo/path.js';
import type { LatLng } from '../geo/serviceArea.js';
import { AppError } from '../http/errors.js';
import type { Logger } from '../logger.js';
import { progressOf, readTripRoute } from './routes.js';

// Road routes for the map (route-paths LLD §3). For drawing only: nothing here is stored
// with a booking or used for a fare. Each is read outside any transaction, so waiting on
// the map service never holds a lock.

export interface PathDeps {
  db: Database;
  paths: PathService;
}

export interface RoutePath {
  legs: PathLeg[];
}

// A leg of the driver's route, ending at one of the trip's stops.
export interface DriverRouteLeg extends PathLeg {
  toStopId: string;
}

// A leg with no line, e.g. between two stops at one place, draws nothing.
function drawn<T extends PathLeg>(legs: readonly T[]): T[] {
  return legs.filter((leg) => leg.points.length > 0);
}

// From one point to another: a trip being priced, or a booking's own ride.
export async function pathBetween(
  paths: PathService,
  log: Logger,
  from: LatLng,
  to: LatLng,
): Promise<RoutePath> {
  return { legs: drawn(await paths.legsThrough([from, to], log)) };
}

// A passenger's own ride, pickup to destination, never the trip it shares (FR-P8, NFR-9).
// Someone else's booking is "not found" (FR-P9, NFR-8).
export async function bookingPath(
  { db, paths }: PathDeps,
  log: Logger,
  passengerId: string,
  bookingId: string,
): Promise<RoutePath> {
  const [booking] = await db
    .select({
      pickup: { lat: bookings.pickupLat, lng: bookings.pickupLng },
      destination: { lat: bookings.destLat, lng: bookings.destLng },
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.passengerId, passengerId)));
  if (!booking) throw new AppError(404, 'NOT_FOUND', 'This ride was not found.');
  return pathBetween(paths, log, booking.pickup, booking.destination);
}

// An open request's own ride, for a driver choosing it. It shows only the pickup and
// destination, which a driver may see before accepting (NFR-9).
export async function requestPath(
  { db, paths }: PathDeps,
  log: Logger,
  bookingId: string,
): Promise<RoutePath> {
  const [request] = await db
    .select({
      pickup: { lat: bookings.pickupLat, lng: bookings.pickupLng },
      destination: { lat: bookings.destLat, lng: bookings.destLng },
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, 'REQUESTED')));
  if (!request) throw new AppError(404, 'NOT_FOUND', 'This request was not found.');
  return pathBetween(paths, log, request.pickup, request.destination);
}

// The driver's route still to come: from the point it goes on from, the same one the
// matching rule plans from and the map puts the Tesla at, through every stop not reached.
// A pickup the driver waits at is where the Tesla is, so no leg leads to it.
export async function driverRoutePath(
  { db, paths }: PathDeps,
  log: Logger,
  driverId: string,
): Promise<{ legs: DriverRouteLeg[] }> {
  const [trip] = await db
    .select({ id: pools.id, lat: vehicles.currentLat, lng: vehicles.currentLng })
    .from(pools)
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .where(and(eq(vehicles.driverId, driverId), eq(pools.status, 'active')));
  if (!trip || trip.lat === null || trip.lng === null) return { legs: [] };

  const route = await readTripRoute(db, trip.id, { lat: trip.lat, lng: trip.lng });
  const { anchor, pinned } = progressOf(route);
  const ahead = route.stops.filter((stop) => stop.reachedKm === null && stop !== pinned);
  if (ahead.length === 0) return { legs: [] };

  const legs = await paths.legsThrough([anchor.point, ...ahead.map((stop) => stop.point)], log);
  return { legs: drawn(legs.map((leg, i) => ({ ...leg, toStopId: ahead[i]!.id }))) };
}
