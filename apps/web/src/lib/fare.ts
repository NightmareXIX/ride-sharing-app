import type { DistanceMethod, RideOption } from './booking';

// A completed ride's fare, as the API returns it. Every figure is a string, so the
// breakdown can be checked by hand (FR-F6).
export interface FareBreakdown {
  pickupOdometerKm: string;
  dropoffOdometerKm: string;
  actualKm: string;
  sharedKm: string;
  directKm: string;
  distanceMethod: DistanceMethod;
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
