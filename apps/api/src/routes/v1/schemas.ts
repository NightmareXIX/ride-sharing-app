import { z } from 'zod';
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
