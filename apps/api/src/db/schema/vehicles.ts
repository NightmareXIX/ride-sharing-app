import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { coordinate } from './columns.js';
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
    // Only online drivers see ride requests (FR-D3, FR-D5).
    isOnline: boolean('is_online').notNull().default(false),
    // Set by hand on the map; there is no live GPS (FR-D4).
    currentLat: coordinate('current_lat'),
    currentLng: coordinate('current_lng'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'vehicles_capacity_range',
      sql`${t.capacity} BETWEEN 1 AND ${sql.raw(String(MAX_VEHICLE_CAPACITY))}`,
    ),
    check('vehicles_location_complete', sql`(${t.currentLat} IS NULL) = (${t.currentLng} IS NULL)`),
    // Backstop for LOCATION_REQUIRED: a Tesla can't be online without a location.
    check('vehicles_online_needs_location', sql`NOT ${t.isOnline} OR ${t.currentLat} IS NOT NULL`),
  ],
);

export type Vehicle = typeof vehicles.$inferSelect;
