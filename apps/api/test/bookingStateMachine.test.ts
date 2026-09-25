import { describe, expect, it } from 'vitest';
import { BOOKING_STATUSES, FINAL_STATUSES } from '../src/domain/booking.js';
import { canTransition, TRANSITIONS } from '../src/domain/bookingStateMachine.js';

describe('booking state machine (FR §6, FR-R8)', () => {
  it.each(TRANSITIONS.map((t) => [t.from, t.to, t.actor] as const))(
    'allows %s → %s by the %s',
    (from, to, actor) => {
      expect(canTransition(from, to, actor)).toBe(true);
    },
  );

  // The rejected examples listed under FR §6.
  it.each([
    ['skipping steps', 'REQUESTED', 'STARTED', 'driver'],
    ['leaving a final state', 'COMPLETED', 'STARTED', 'driver'],
    ['cancelling after pickup', 'STARTED', 'CANCELLED', 'passenger'],
    ['cancelling after pickup, as the driver', 'STARTED', 'CANCELLED', 'driver'],
    ['a passenger starting their own ride', 'DRIVER_ARRIVED', 'STARTED', 'passenger'],
    ['a passenger accepting a request', 'REQUESTED', 'ACCEPTED', 'passenger'],
    ['a driver cancelling a request nobody accepted', 'REQUESTED', 'CANCELLED', 'driver'],
    ['un-cancelling', 'CANCELLED', 'REQUESTED', 'passenger'],
  ] as const)('refuses %s (%s → %s by the %s)', (_name, from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(false);
  });

  it('never leaves a final state', () => {
    for (const from of FINAL_STATUSES) {
      for (const to of BOOKING_STATUSES) {
        expect(canTransition(from, to, 'passenger')).toBe(false);
        expect(canTransition(from, to, 'driver')).toBe(false);
      }
    }
  });

  it('never stays in place', () => {
    expect(TRANSITIONS.filter((t) => t.from === t.to)).toEqual([]);
  });
});
