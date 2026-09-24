import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Upper bound on passenger seats: the largest Tesla (Model X) seats 6 besides the driver.
export const MAX_VEHICLE_CAPACITY = 6;

// A driver's Tesla, registered at sign-up; exactly one per driver (FR-D1).
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .unique()
      .references(() => users.id),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'vehicles_capacity_range',
      sql`${t.capacity} BETWEEN 1 AND ${sql.raw(String(MAX_VEHICLE_CAPACITY))}`,
    ),
  ],
);

export type Vehicle = typeof vehicles.$inferSelect;
