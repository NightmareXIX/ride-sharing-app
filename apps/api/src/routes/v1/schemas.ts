import { z } from 'zod';
import { MAX_VEHICLE_CAPACITY } from '../../db/schema/index.js';
import { RIDE_OPTIONS } from '../../domain/fare.js';
import { haversineKm } from '../../geo/haversine.js';
import { SERVICE_AREA } from '../../geo/serviceArea.js';

const OUTSIDE_DHAKA = 'must be inside Dhaka';

// Coordinates are stored to 6 decimal places, so they are rounded here once and the
// same value is used for the distance, the cache key and the stored row.
function roundTo6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

const latitude = z
  .number('must be a number')
  .min(SERVICE_AREA.minLat, OUTSIDE_DHAKA)
  .max(SERVICE_AREA.maxLat, OUTSIDE_DHAKA)
  .transform(roundTo6);

const longitude = z
  .number('must be a number')
  .min(SERVICE_AREA.minLng, OUTSIDE_DHAKA)
  .max(SERVICE_AREA.maxLng, OUTSIDE_DHAKA)
  .transform(roundTo6);

// A location set by hand on the map (FR-D4).
export const location = z.object({ lat: latitude, lng: longitude }, 'must be a location');

// A named place: a pickup or a destination.
export const place = location.extend({
  label: z.string().trim().min(1, 'is required').max(120, 'must be at most 120 characters'),
});

// Route ids that aren't UUIDs can't match anything, so they are simply not found.
export const uuidParam = z.uuid();

// Pickup and destination this close together aren't a ride.
export const MIN_TRIP_KM = 0.1;

// A trip to price or request (FR-P3). Seats are checked against the largest Tesla later.
export const trip = z
  .object({
    pickup: place,
    destination: place,
    seats: z
      .int('must be a whole number')
      .min(1, 'must be at least 1')
      .max(MAX_VEHICLE_CAPACITY, `must be at most ${MAX_VEHICLE_CAPACITY}`),
    rideOption: z.enum(RIDE_OPTIONS, 'must be pool, same_gender or solo'),
  })
  .refine((t) => haversineKm(t.pickup, t.destination) >= MIN_TRIP_KM, {
    path: ['destination'],
    message: 'must be at least 100 m from the pickup',
  });
