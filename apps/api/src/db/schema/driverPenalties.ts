import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bookings } from './bookings.js';
import { users } from './users.js';

// A driver cancelled a booking more than 3 minutes after accepting it (FR-D13). What a
// penalty leads to isn't decided yet (FR §13), so it is only recorded and counted. Kept
// forever (NFR-40): a trigger in the migration refuses UPDATE and DELETE.
export const driverPenalties = pgTable(
  'driver_penalties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id),
    // A booking can be accepted and dropped more than once, so it isn't unique here.
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('driver_penalties_driver_id_idx').on(t.driverId)],
);

export type DriverPenalty = typeof driverPenalties.$inferSelect;
