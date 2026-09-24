import type { BookingStatus } from './booking.js';

// Who may make a change. A driver may only act on bookings in their own trip; the
// services check that, since it needs the database.
export type Actor = 'passenger' | 'driver';

export interface Transition {
  from: BookingStatus;
  to: BookingStatus;
  actor: Actor;
}

// Every allowed change, straight from FR §6. Anything not listed is refused (FR-R8).
export const TRANSITIONS: readonly Transition[] = [
  { from: 'REQUESTED', to: 'ACCEPTED', actor: 'driver' },
  // Always free before acceptance.
  { from: 'REQUESTED', to: 'CANCELLED', actor: 'passenger' },
  // Free within 3 minutes of acceptance, then a fine (phase 6).
  { from: 'ACCEPTED', to: 'CANCELLED', actor: 'passenger' },
  { from: 'DRIVER_ARRIVED', to: 'CANCELLED', actor: 'passenger' },
  // A driver cancel puts the request back for other drivers.
  { from: 'ACCEPTED', to: 'REQUESTED', actor: 'driver' },
  { from: 'DRIVER_ARRIVED', to: 'REQUESTED', actor: 'driver' },
  { from: 'ACCEPTED', to: 'DRIVER_ARRIVED', actor: 'driver' },
  // No-show, at least 5 minutes after arrival.
  { from: 'DRIVER_ARRIVED', to: 'CANCELLED', actor: 'driver' },
  { from: 'DRIVER_ARRIVED', to: 'STARTED', actor: 'driver' },
  { from: 'STARTED', to: 'COMPLETED', actor: 'driver' },
];

export function canTransition(from: BookingStatus, to: BookingStatus, actor: Actor): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to && t.actor === actor);
}
