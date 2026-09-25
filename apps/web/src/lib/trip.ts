import type { BookingStatus, PaymentMethod, RideOption } from './booking';
import type { FareBreakdown } from './fare';
import type { Place } from './geo';

// A ride request as a driver sees it before accepting: where and what, never who.
export interface NearbyRequest {
  id: string;
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  directKm: string;
  estimatedFare: string;
  requestedAt: string;
  // Straight-line km from the driver's Tesla.
  pickupDistanceKm: string;
}

export type NextAction = 'arrive' | 'start' | 'complete';

// One passenger in the driver's Tesla.
export interface TripBooking {
  id: string;
  passenger: { name: string };
  status: Extract<BookingStatus, 'ACCEPTED' | 'DRIVER_ARRIVED' | 'STARTED'>;
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  directKm: string;
  estimatedFare: string;
  acceptedAt: string;
  arrivedAt: string | null;
  startedAt: string | null;
  nextAction: NextAction;
}

// The body of GET /driver/pool and every trip action, with the Tesla's seats as they stand.
export interface DriverTrip {
  id: string;
  createdAt: string;
  seats: { capacity: number; taken: number };
  bookings: TripBooking[];
}

export interface CompletedTrip {
  pool: DriverTrip | null;
  fare: FareBreakdown;
}
