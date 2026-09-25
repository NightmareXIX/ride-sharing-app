import type { Role } from './account';
import type { Booking } from './booking';

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
