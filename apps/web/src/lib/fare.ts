import type { DistanceMethod, RideOption } from './booking';

// A completed ride's fare, as the API returns it. Every figure is a string, so the
// breakdown can be checked by hand (FR-F6).
export interface FareBreakdown {
  pickupOdometerKm: string;
  dropoffOdometerKm: string;
  actualKm: string;
  sharedKm: string;
  directKm: string;
  // How the direct km, and so the estimate, was measured.
  distanceMethod: DistanceMethod;
  // How the ride's own legs were measured.
  routeDistanceMethod: DistanceMethod;
  baseFare: string;
  perKmRate: string;
  sharedKmDiscount: string;
  seats: number;
  seatMultiplier: string;
  rideOption: RideOption;
  optionMultiplier: string;
  estimatedFare: string;
  computedFare: string;
  finalFare: string;
}
