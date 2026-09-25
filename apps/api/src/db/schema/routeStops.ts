import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings.js';
import { coordinate } from './columns.js';
import { distanceMethod } from './distanceCache.js';
import { pools } from './pools.js';

export const stopType = pgEnum('stop_type', ['pickup', 'dropoff']);

function odometer(name: string) {
  return numeric(name, { precision: 8, scale: 3 });
}

// One stop on a trip's route: a booking's pickup or drop-off (Core Entities: RouteStop).
// Planned km are set when the route is planned and re-planned while the stop is ahead.
// Reaching the stop copies them as the reading, which then never changes (FR-L5,
// NFR-41): a trigger in the migration refuses UPDATE and DELETE of a reached stop.
export const routeStops = pgTable(
  'route_stops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    poolId: uuid('pool_id')
      .notNull()
      .references(() => pools.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    type: stopType('type').notNull(),
    sequence: integer('sequence').notNull(),
    lat: coordinate('lat').notNull(),
    lng: coordinate('lng').notNull(),
    // Km along the trip at this stop, counted from where the Tesla began it.
    plannedOdometerKm: odometer('planned_odometer_km').notNull(),
    actualOdometerKm: odometer('actual_odometer_km'),
    reachedAt: timestamp('reached_at', { withTimezone: true }),
    // How the leg into this stop was measured (NFR-13).
    distanceMethod: distanceMethod('distance_method').notNull(),
  },
  (t) => [
    unique('route_stops_pool_sequence').on(t.poolId, t.sequence),
    unique('route_stops_booking_type').on(t.bookingId, t.type),
    check('route_stops_sequence_positive', sql`${t.sequence} >= 1`),
    check('route_stops_planned_non_negative', sql`${t.plannedOdometerKm} >= 0`),
    check('route_stops_reached', sql`(${t.reachedAt} IS NULL) = (${t.actualOdometerKm} IS NULL)`),
    // No distance is measured on arrival: the reading is the planned km (Core Entities §3).
    check(
      'route_stops_reading_is_planned',
      sql`${t.actualOdometerKm} IS NULL OR ${t.actualOdometerKm} = ${t.plannedOdometerKm}`,
    ),
  ],
);

export type RouteStop = typeof routeStops.$inferSelect;
