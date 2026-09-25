import { sql } from 'drizzle-orm';
import { check, integer, numeric, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bookings, rideOption } from './bookings.js';
import { distanceMethod } from './distanceCache.js';

function km(name: string) {
  return numeric(name, { precision: 7, scale: 3 });
}

function odometer(name: string) {
  return numeric(name, { precision: 8, scale: 3 });
}

function multiplier(name: string) {
  return numeric(name, { precision: 4, scale: 2 });
}

function money(name: string) {
  return numeric(name, { precision: 10, scale: 2 });
}

// How a completed booking's fare was worked out, so anyone can check it by hand (FR-F6).
// Written once, with the completion, and never changed (NFR-41): a trigger in the
// migration refuses UPDATE and DELETE.
export const fares = pgTable(
  'fares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id),
    pickupOdometerKm: odometer('pickup_odometer_km').notNull(),
    dropoffOdometerKm: odometer('dropoff_odometer_km').notNull(),
    actualKm: km('actual_km').notNull(),
    sharedKm: km('shared_km').notNull(),
    directKm: km('direct_km').notNull(),
    seats: integer('seats').notNull(),
    seatMultiplier: multiplier('seat_multiplier').notNull(),
    rideOption: rideOption('ride_option').notNull(),
    optionMultiplier: multiplier('option_multiplier').notNull(),
    estimatedFare: money('estimated_fare').notNull(),
    computedFare: money('computed_fare').notNull(),
    finalFare: money('final_fare').notNull(),
    distanceMethod: distanceMethod('distance_method').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The passenger never pays more than their estimate (FR-P4, FR-F5).
    check('fares_final_within_estimate', sql`${t.finalFare} <= ${t.estimatedFare}`),
    check('fares_shared_within_actual', sql`${t.sharedKm} <= ${t.actualKm}`),
  ],
);

export type Fare = typeof fares.$inferSelect;
