import { and, asc, between, eq, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { bookings } from '../db/schema/index.js';
import type { PaymentMethod } from '../domain/booking.js';
import {
  boundingBox,
  isNearby,
  pickupDistanceKm,
  type DispatchConfig,
} from '../domain/dispatch.js';
import type { RideOption } from '../domain/fare.js';
import { bestInsertion } from '../domain/matching.js';
import { freeSeats } from '../domain/seats.js';
import type { LegLookup } from '../geo/distance.js';
import type { LatLng } from '../geo/serviceArea.js';
import type { Logger } from '../logger.js';
import type { Place } from './bookings.js';
import { activePoolId, type TripDeps } from './pools.js';
import { matchingRoute, readTripRoute } from './routes.js';
import { getDriverVehicle } from './vehicles.js';

// A request as a driver sees it before accepting: where and what, never who (NFR-9).
export interface NearbyRequest {
  id: string;
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  directKm: string;
  estimatedFare: string;
  requestedAt: Date;
  // Straight-line km from the Tesla, or from where its route goes on.
  pickupDistanceKm: string;
  // How much longer the route gets with this request in it. Null for an idle Tesla.
  addedKm: string | null;
}

// Enough to choose from; a full Bullet has no seats for any of them.
const MAX_LISTED = 20;

// A refresh route-checks at most this many requests that need the map service; the rest
// wait for a later refresh (NFR-3). Requests checked before are cached, so they're free.
export const NEW_ROUTE_CHECKS_PER_REFRESH = 3;

const requestColumns = {
  id: bookings.id,
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
  requestedAt: bookings.requestedAt,
};

type RequestRow = Awaited<ReturnType<typeof openRequests>>[number];

// Open requests that fit the free seats, oldest first.
function openRequests(db: Database, seatsLeft: number, near?: ReturnType<typeof boundingBox>) {
  return db
    .select(requestColumns)
    .from(bookings)
    .where(
      and(
        eq(bookings.status, 'REQUESTED'),
        lte(bookings.seats, seatsLeft),
        near && between(bookings.pickupLat, near.minLat, near.maxLat),
        near && between(bookings.pickupLng, near.minLng, near.maxLng),
      ),
    )
    .orderBy(asc(bookings.requestedAt), asc(bookings.id));
}

function pickupOf(row: RequestRow): LatLng {
  return { lat: row.pickupLat, lng: row.pickupLng };
}

function destinationOf(row: RequestRow): LatLng {
  return { lat: row.destLat, lng: row.destLng };
}

function toNearbyRequest(row: RequestRow, from: LatLng, addedKm: string | null): NearbyRequest {
  const { pickupLat, pickupLng, pickupLabel, destLat, destLng, destLabel, ...rest } = row;
  return {
    ...rest,
    pickup: { lat: pickupLat, lng: pickupLng, label: pickupLabel },
    destination: { lat: destLat, lng: destLng, label: destLabel },
    pickupDistanceKm: pickupDistanceKm(from, pickupOf(row)),
    addedKm,
  };
}

// Open requests an online driver may accept, oldest first (FR-D5–D7, FR-D9). An offline
// driver, or one whose Tesla is full, sees none. An idle Tesla sees requests near it; one
// with passengers sees those that fit its route (FR-L3).
export async function listNearbyRequests(
  deps: TripDeps,
  log: Logger,
  driverId: string,
  dispatch: DispatchConfig,
): Promise<NearbyRequest[]> {
  const { db } = deps;
  const tesla = await getDriverVehicle(db, driverId);
  const here = tesla.location;
  if (!tesla.isOnline || !here) return [];
  const seatsLeft = freeSeats(tesla.capacity, tesla.occupiedSeats);
  if (seatsLeft === 0) return [];

  const poolId = await activePoolId(db, tesla.id);
  if (poolId !== null) return requestsOnRoute(deps, log, poolId, here, seatsLeft, dispatch);

  // An idle Tesla: a straight-line radius, so the list never waits on the map (NFR-1).
  const rows = await openRequests(db, seatsLeft, boundingBox(here, dispatch.searchRadiusKm));
  return rows
    .filter((row) => isNearby(here, pickupOf(row), dispatch.searchRadiusKm))
    .slice(0, MAX_LISTED)
    .map((row) => toNearbyRequest(row, here, null));
}

// A Tesla with passengers sees the requests that fit its route (NFR §2): first a quick
// check with no map, a pickup within the search radius of the route; then the matching
// rule with road distances, calling the map service for at most 3 requests (NFR-3).
async function requestsOnRoute(
  { db, distance }: TripDeps,
  log: Logger,
  poolId: string,
  origin: LatLng,
  seatsLeft: number,
  { searchRadiusKm }: DispatchConfig,
): Promise<NearbyRequest[]> {
  const route = matchingRoute(await readTripRoute(db, poolId, origin));
  const onRoute = [route.anchor.point, ...route.pending.map((stop) => stop.point)];
  const candidates = (await openRequests(db, seatsLeft)).filter((row) =>
    onRoute.some((point) => isNearby(point, pickupOf(row), searchRadiusKm)),
  );
  const pointsFor = (row: RequestRow) => [...onRoute, pickupOf(row), destinationOf(row)];

  // Requests whose distances are all known, or that need no map request, are checked now.
  const legs = new Map<string, LegLookup | null>();
  for (const row of candidates) {
    legs.set(row.id, await distance.legKm(pointsFor(row), log, { remaining: 0 }));
  }
  // The oldest few that need the map service ask it together; the rest wait.
  const unmeasured = candidates.filter((row) => legs.get(row.id) === null);
  const measuring = unmeasured.slice(0, NEW_ROUTE_CHECKS_PER_REFRESH);
  if (unmeasured.length > measuring.length) {
    log.info({ waiting: unmeasured.length - measuring.length }, 'Route checks left for later');
  }
  await Promise.all(
    measuring.map(async (row) => legs.set(row.id, await distance.legKm(pointsFor(row), log))),
  );

  const listed: NearbyRequest[] = [];
  for (const row of candidates) {
    const leg = legs.get(row.id);
    if (!leg) continue;
    const match = bestInsertion(
      route,
      {
        bookingId: row.id,
        pickup: pickupOf(row),
        destination: destinationOf(row),
        directKm: row.directKm,
      },
      leg,
    );
    if (match.ok) listed.push(toNearbyRequest(row, route.anchor.point, match.addedKm));
    if (listed.length === MAX_LISTED) break;
  }
  return listed;
}
