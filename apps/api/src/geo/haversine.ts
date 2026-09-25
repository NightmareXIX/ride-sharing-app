import type { LatLng } from './serviceArea.js';

const EARTH_RADIUS_KM = 6371;

// Roads are rarely straight: the fallback stretches the straight line by 30% (FR-L2).
export const ROAD_FACTOR = 1.3;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// Great-circle distance between two points, in km.
export function haversineKm(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// The distance used when the map service can't answer (NFR-13), to the metre.
export function fallbackRoadKm(from: LatLng, to: LatLng): string {
  return (haversineKm(from, to) * ROAD_FACTOR).toFixed(3);
}
