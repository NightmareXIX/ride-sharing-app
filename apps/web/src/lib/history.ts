import type { Role } from './account';
import type { Booking, PaymentMethod, RideOption } from './booking';
import type { FareBreakdown } from './fare';
import type { Place } from './geo';

// Where each role finds what it did before.
export function historyPath(role: Role): string {
  return role === 'passenger' ? '/passenger/rides' : '/driver/trips';
}

// The body of GET /bookings: the passenger's past rides, newest first.
export interface RidePage {
  bookings: Booking[];
  nextCursor: string | null;
}

export type Tone = 'good' | 'warn' | 'plain';

// How a past ride ended, in the passenger's words.
export function rideOutcome(booking: Booking): { label: string; tone: Tone } {
  if (booking.status === 'COMPLETED') return { label: 'Completed', tone: 'good' };
  if (booking.fine?.reason === 'no_show') return { label: 'No-show', tone: 'warn' };
  if (booking.fine) return { label: 'Cancelled late', tone: 'warn' };
  if (booking.status === 'CANCELLED') return { label: 'Cancelled', tone: 'plain' };
  return { label: 'In progress', tone: 'plain' };
}

// When the ride ended, or when it was asked for if it hasn't.
export function endedAt(booking: Booking): string {
  return booking.completedAt ?? booking.cancelledAt ?? booking.requestedAt;
}

// Money a driver earned, as strings such as "123.44".
export interface EarningsSplit {
  total: string;
  cash: string;
  teslapay: string;
}

// The body of GET /driver/earnings: all-time totals from the ledger.
export interface Earnings extends EarningsSplit {
  rides: number;
}

// One of the driver's finished trips.
export interface TripSummary {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  // Every passenger entry, including those the driver dropped.
  passengers: number;
  completed: number;
  earnings: EarningsSplit;
}

// The body of GET /driver/pools: finished trips, newest first.
export interface TripPage {
  pools: TripSummary[];
  nextCursor: string | null;
}

export type TripOutcome =
  'completed' | 'passenger_cancelled' | 'late_cancel' | 'no_show' | 'driver_cancelled';

// One passenger in a finished trip, as the driver sees them.
export interface PastTripBooking {
  id: string;
  passenger: { name: string };
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  estimatedFare: string;
  outcome: TripOutcome;
  endedAt: string;
  fare: FareBreakdown | null;
  penaltyRecorded: boolean;
}

// The body of GET /driver/pools/:id.
export interface PastTrip extends TripSummary {
  vehicle: { name: string };
  bookings: PastTripBooking[];
}

// How a passenger's part in the trip ended, in the driver's words.
export const TRIP_OUTCOMES: Record<TripOutcome, { label: string; tone: Tone }> = {
  completed: { label: 'Completed', tone: 'good' },
  passenger_cancelled: { label: 'Cancelled', tone: 'plain' },
  late_cancel: { label: 'Cancelled late', tone: 'warn' },
  no_show: { label: 'No-show', tone: 'warn' },
  driver_cancelled: { label: 'You cancelled', tone: 'plain' },
};
