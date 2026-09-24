import { max } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { vehicles } from '../db/schema/index.js';
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

export interface Quote extends FareEstimate {
  distanceMethod: DistanceMethod;
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
