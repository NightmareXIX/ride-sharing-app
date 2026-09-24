import { and, eq, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Transaction } from '../db/client.js';
import { bookings, bookingStatusHistory } from '../db/schema/index.js';
import type { BookingStatus } from '../domain/booking.js';
import { canTransition, type Actor } from '../domain/bookingStateMachine.js';

export interface TransitionRequest {
  bookingId: string;
  // Limits the booking to ones the actor may touch, e.g. the passenger's own.
  owner: SQL;
  // The states this action starts from. The booking must be in one of them.
  from: readonly BookingStatus[];
  to: BookingStatus;
  actor: { id: string; role: Actor };
  // Recorded in the history, e.g. passenger_cancel, no_show (FR-R11).
  reason: string;
  // Other columns the change sets, e.g. cancelled_at.
  set?: PgUpdateSetSource<typeof bookings>;
}

export type TransitionOutcome =
  | { ok: true }
  // `current` is null when the booking doesn't exist or isn't the actor's to touch.
  | { ok: false; current: BookingStatus | null };

// The one way a booking changes state (FR-C4). Inside the caller's transaction it locks
// the row, runs `UPDATE … WHERE id = ? AND status = <expected>`, and writes the history
// row, so the change and its record commit together or not at all.
export async function transitionBooking(
  tx: Transaction,
  request: TransitionRequest,
): Promise<TransitionOutcome> {
  const { bookingId, to, actor } = request;
  const [locked] = await tx
    .select({ status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), request.owner))
    .for('update');
  if (!locked) return { ok: false, current: null };

  const from = locked.status;
  if (!request.from.includes(from)) return { ok: false, current: from };
  if (!canTransition(from, to, actor.role)) {
    // The caller asked for a change FR §6 doesn't have: a bug, not a user error.
    throw new Error(`${actor.role} may not move a booking from ${from} to ${to}`);
  }

  const updated = await tx
    .update(bookings)
    .set({ ...request.set, status: to })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, from)))
    .returning({ id: bookings.id });
  if (updated.length !== 1) throw new Error(`Booking ${bookingId} changed while locked`);

  await tx.insert(bookingStatusHistory).values({
    bookingId,
    fromStatus: from,
    toStatus: to,
    actorId: actor.id,
    reason: request.reason,
  });
  return { ok: true };
}
