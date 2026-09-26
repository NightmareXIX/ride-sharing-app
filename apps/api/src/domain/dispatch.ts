import { haversineKm } from '../geo/haversine.js';
import type { LatLng } from '../geo/serviceArea.js';
import type { AssignedStatus } from './booking.js';

// Which requests a driver is shown, kept free of I/O so it is easy to test (NFR-26).
// Phase 5 grows this into the matching rule (FR-L3).

export interface DispatchConfig {
  // How far from the Tesla an idle driver sees requests (FR-D6). Default 2 km.
  searchRadiusKm: number;
}

// Nearness is a straight line, so listing requests never waits on the map service (NFR-1).
export function isNearby(tesla: LatLng, pickup: LatLng, radiusKm: number): boolean {
  return haversineKm(tesla, pickup) <= radiusKm;
}

// Straight-line km from the Tesla to a pickup, to the metre.
export function pickupDistanceKm(tesla: LatLng, pickup: LatLng): string {
  return haversineKm(tesla, pickup).toFixed(3);
}

// A Tesla's point as a passenger sees it: to 3 decimal places, about 110 m, so it shows
// that a car is near without pinning down where a driver is (NFR-9).
export function blurPoint({ lat, lng }: LatLng): LatLng {
  return { lat: Math.round(lat * 1e3) / 1e3, lng: Math.round(lng * 1e3) / 1e3 };
}

const KM_PER_DEGREE_LAT = 110.574;
const KM_PER_DEGREE_LNG_AT_EQUATOR = 111.32;

// A box of coordinates that contains the whole circle, so the database can narrow the
// rows before the exact distance decides.
export function boundingBox(center: LatLng, radiusKm: number) {
  const dLat = radiusKm / KM_PER_DEGREE_LAT;
  const dLng = radiusKm / (KM_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((center.lat * Math.PI) / 180));
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

// The one step a driver can take next for a passenger in their Tesla (FR-D10).
export type NextAction = 'arrive' | 'start' | 'complete';

const NEXT_ACTIONS: Record<AssignedStatus, NextAction> = {
  ACCEPTED: 'arrive',
  DRIVER_ARRIVED: 'start',
  STARTED: 'complete',
};

export function nextAction(status: AssignedStatus): NextAction {
  return NEXT_ACTIONS[status];
}
