import type { LatLng } from './geo';

// The Teslas that could take a passenger now, near a pickup: rough points, never who
// (passenger nearby Teslas LLD). For looking only; a passenger can't choose one.
export interface NearbyTeslas {
  radiusKm: number;
  teslas: LatLng[];
}

// "2 Teslas within 2 km of your pickup."
export function describeNearby({ radiusKm, teslas }: NearbyTeslas): string {
  if (teslas.length === 0) {
    return `No Teslas within ${radiusKm} km right now. You can still request a ride.`;
  }
  const count = teslas.length === 1 ? '1 Tesla' : `${teslas.length} Teslas`;
  return `${count} within ${radiusKm} km of your pickup. A nearby driver accepts your request; you can’t choose one.`;
}
