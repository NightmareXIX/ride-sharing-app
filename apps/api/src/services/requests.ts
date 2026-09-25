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
import { freeSeats } from '../domain/seats.js';
import type { Place } from './bookings.js';
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
  pickupDistanceKm: string;
}

// Enough to choose from; a full Bullet has no seats for any of them.
const MAX_LISTED = 20;

// Open requests an online driver may accept, oldest first (FR-D5, FR-D6): they fit the
// Tesla's free seats and their pickup is in range (FR-D7, FR-D9). An offline driver, or
// one whose Tesla is full, sees none. Phase 5 adds the matching rule for a Tesla with
// passengers (FR-L3).
export async function listNearbyRequests(
  db: Database,
  driverId: string,
  { searchRadiusKm }: DispatchConfig,
): Promise<NearbyRequest[]> {
  const tesla = await getDriverVehicle(db, driverId);
  const here = tesla.location;
  if (!tesla.isOnline || !here) return [];
  const seatsLeft = freeSeats(tesla.capacity, tesla.occupiedSeats);
  if (seatsLeft === 0) return [];

  const box = boundingBox(here, searchRadiusKm);
  const rows = await db
    .select({
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
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, 'REQUESTED'),
        lte(bookings.seats, seatsLeft),
        between(bookings.pickupLat, box.minLat, box.maxLat),
        between(bookings.pickupLng, box.minLng, box.maxLng),
      ),
    )
    .orderBy(asc(bookings.requestedAt), asc(bookings.id));

  return rows
    .filter((row) => isNearby(here, { lat: row.pickupLat, lng: row.pickupLng }, searchRadiusKm))
    .slice(0, MAX_LISTED)
    .map(({ pickupLat, pickupLng, pickupLabel, destLat, destLng, destLabel, ...rest }) => ({
      ...rest,
      pickup: { lat: pickupLat, lng: pickupLng, label: pickupLabel },
      destination: { lat: destLat, lng: destLng, label: destLabel },
      pickupDistanceKm: pickupDistanceKm(here, { lat: pickupLat, lng: pickupLng }),
    }));
}
