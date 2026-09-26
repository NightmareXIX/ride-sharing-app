import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { bookings, pools, routeStops, users, vehicles } from '../db/schema/index.js';
import { isAssigned, type BookingStatus } from '../domain/booking.js';
import { blurPoint, isNearby } from '../domain/dispatch.js';
import { joinRule, type Rider } from '../domain/rideOptions.js';
import { routeProgress, type TripStop } from '../domain/route.js';
import type { LatLng } from '../geo/serviceArea.js';

// The Teslas a passenger sees near a pickup: where cars are, never who (passenger nearby
// Teslas LLD). Looking only; the passenger can't choose one (FR-D8).
export interface NearbyTeslas {
  radiusKm: number;
  teslas: LatLng[];
}

interface TripState {
  stops: TripStop[];
  statuses: Map<string, BookingStatus>;
  riders: Map<string, Rider>;
}

// The stops of these trips in order, with what each booking's status and ride option say
// about the Tesla.
async function readTrips(db: Database, poolIds: string[]): Promise<Map<string, TripState>> {
  const trips = new Map<string, TripState>();
  if (poolIds.length === 0) return trips;
  const rows = await db
    .select({
      poolId: routeStops.poolId,
      bookingId: routeStops.bookingId,
      type: routeStops.type,
      lat: routeStops.lat,
      lng: routeStops.lng,
      plannedKm: routeStops.plannedOdometerKm,
      reachedKm: routeStops.actualOdometerKm,
      method: routeStops.distanceMethod,
      status: bookings.status,
      rideOption: bookings.rideOption,
      // For the ride-option rule only; never sent (NFR-9).
      gender: users.gender,
    })
    .from(routeStops)
    .innerJoin(bookings, eq(bookings.id, routeStops.bookingId))
    .innerJoin(users, eq(users.id, bookings.passengerId))
    .where(inArray(routeStops.poolId, poolIds))
    .orderBy(asc(routeStops.poolId), asc(routeStops.sequence));

  for (const row of rows) {
    let trip = trips.get(row.poolId);
    if (!trip) {
      trip = { stops: [], statuses: new Map(), riders: new Map() };
      trips.set(row.poolId, trip);
    }
    trip.stops.push({
      bookingId: row.bookingId,
      type: row.type,
      point: { lat: row.lat, lng: row.lng },
      plannedKm: row.plannedKm,
      reachedKm: row.reachedKm,
      method: row.method,
    });
    trip.statuses.set(row.bookingId, row.status);
    // Accepted, waited for or aboard, as the ride-option rule counts them (FR-R10).
    if (isAssigned(row.status)) {
      trip.riders.set(row.bookingId, { rideOption: row.rideOption, gender: row.gender });
    }
  }
  return trips;
}

// Online Teslas with a free seat, each at its latest checkpoint, within `radiusKm` of the
// point in a straight line (NFR-1). A Tesla on a trip is where its route goes on from, as
// the driver's map and the matching rule see it; one on a solo ride takes no one, so it is
// left out. Points are blurred and sent without ids, in coordinate order (NFR-9).
export async function listNearbyTeslas(
  db: Database,
  near: LatLng,
  radiusKm: number,
): Promise<NearbyTeslas> {
  // Not narrowed by a box: a Tesla on a trip may be far from where it began it.
  const candidates = await db
    .select({ lat: vehicles.currentLat, lng: vehicles.currentLng, poolId: pools.id })
    .from(vehicles)
    .leftJoin(pools, and(eq(pools.vehicleId, vehicles.id), eq(pools.status, 'active')))
    .where(and(eq(vehicles.isOnline, true), lt(vehicles.occupiedSeats, vehicles.capacity)));

  const trips = await readTrips(
    db,
    candidates.flatMap((tesla) => (tesla.poolId ? [tesla.poolId] : [])),
  );

  const teslas: LatLng[] = [];
  for (const { lat, lng, poolId } of candidates) {
    if (lat === null || lng === null) continue;
    let point: LatLng = { lat, lng };
    const trip = poolId ? trips.get(poolId) : undefined;
    if (trip) {
      if (joinRule([...trip.riders.values()]) === 'no_one') continue;
      point = routeProgress(
        trip.stops,
        point,
        (bookingId) => trip.statuses.get(bookingId) === 'DRIVER_ARRIVED',
      ).anchor.point;
    }
    if (isNearby(point, near, radiusKm)) teslas.push(blurPoint(point));
  }
  teslas.sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  return { radiusKm, teslas };
}
