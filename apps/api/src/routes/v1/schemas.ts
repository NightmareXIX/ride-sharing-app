import { z } from 'zod';
import { MAX_VEHICLE_CAPACITY } from '../../db/schema/index.js';
import { RIDE_OPTIONS } from '../../domain/fare.js';
import { AppError } from '../../http/errors.js';
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

// A point in the query string, e.g. `?lat=23.7937&lng=90.4066`. The text is read as a
// number, and an empty or missing one is refused rather than read as 0.
function queryNumber(schema: typeof latitude) {
  return z.preprocess(
    (raw) => (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw),
    schema,
  );
}

// Where to look for Teslas near: the pickup being chosen.
export const nearbyQuery = z.object({ lat: queryNumber(latitude), lng: queryNumber(longitude) });

// A named place: a pickup or a destination.
export const place = location.extend({
  label: z.string().trim().min(1, 'is required').max(120, 'must be at most 120 characters'),
});

// Route ids that aren't UUIDs can't match anything, so they are simply not found.
const uuidParam = z.uuid();

// A booking id from the path. One that isn't a UUID can't be anyone's booking, so it is
// not found rather than invalid (NFR-8).
export function bookingId(raw: string): string {
  const parsed = uuidParam.safeParse(raw);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', 'This ride was not found.');
  return parsed.data;
}

// A trip id from the path, not found rather than invalid, as for bookings (NFR-8).
export function poolId(raw: string): string {
  const parsed = uuidParam.safeParse(raw);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', 'This trip was not found.');
  return parsed.data;
}

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
