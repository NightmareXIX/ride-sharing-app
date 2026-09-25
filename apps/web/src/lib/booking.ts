import type { Place } from './geo';

export type RideOption = 'pool' | 'same_gender' | 'solo';
export type PaymentMethod = 'cash' | 'teslapay';
export type BookingStatus =
  'REQUESTED' | 'ACCEPTED' | 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
export type DistanceMethod = 'routed' | 'fallback';

export const RIDE_OPTION_LABELS: Record<RideOption, string> = {
  pool: 'Pool',
  same_gender: 'Same-gender pool',
  solo: 'Solo',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  teslapay: 'TeslaPay',
};

// The body of POST /fare-estimates. Every figure is a string, never a float.
export interface FareQuote {
  directKm: string;
  distanceMethod: DistanceMethod;
  baseFare: string;
  perKmRate: string;
  seatMultiplier: string;
  optionMultiplier: string;
  estimatedFare: string;
}

// A passenger's own booking, as the API returns it.
export interface Booking {
  id: string;
  status: BookingStatus;
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  directKm: string;
  distanceMethod: DistanceMethod;
  estimatedFare: string;
  requestedAt: string;
  cancelledAt: string | null;
}
