import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { BOOKING_STATUSES, FINAL_STATUSES, PAYMENT_METHODS } from '../../domain/booking.js';
import { RIDE_OPTIONS } from '../../domain/fare.js';
import { coordinate } from './columns.js';
import { distanceMethod } from './distanceCache.js';
import { pools } from './pools.js';
import { users } from './users.js';
import { MAX_VEHICLE_CAPACITY } from './vehicles.js';

export const bookingStatus = pgEnum('booking_status', BOOKING_STATUSES);
export const rideOption = pgEnum('ride_option', RIDE_OPTIONS);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);

const finalStatusList = sql.raw(FINAL_STATUSES.map((status) => `'${status}'`).join(', '));

// One passenger's ride request and its lifecycle (Core Entities: Booking).
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    passengerId: uuid('passenger_id')
      .notNull()
      .references(() => users.id),
    pickupLat: coordinate('pickup_lat').notNull(),
    pickupLng: coordinate('pickup_lng').notNull(),
    pickupLabel: text('pickup_label').notNull(),
    destLat: coordinate('dest_lat').notNull(),
    destLng: coordinate('dest_lng').notNull(),
    destLabel: text('dest_label').notNull(),
    seats: integer('seats').notNull(),
    rideOption: rideOption('ride_option').notNull(),
    paymentMethod: paymentMethod('payment_method').notNull(),
    // Road distance at request time, and how it was measured. Recorded once and never
    // recalculated (NFR-13, NFR-41).
    directKm: numeric('direct_km', { precision: 7, scale: 3 }).notNull(),
    distanceMethod: distanceMethod('distance_method').notNull(),
    estimatedFare: numeric('estimated_fare', { precision: 10, scale: 2 }).notNull(),
    status: bookingStatus('status').notNull().default('REQUESTED'),
    // The database clock decides every time window (NFR-38).
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // The trip the booking belongs to now (FR-R6). Empty while it waits for a driver; a
    // driver cancel empties it again, and the history keeps the pool it left.
    poolId: uuid('pool_id').references(() => pools.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('bookings_pool_id_idx').on(t.poolId),
    // Drivers read the open requests, oldest first, every 4 seconds (NFR-3).
    index('bookings_open_requests_idx')
      .on(t.requestedAt)
      .where(sql`${t.status} = 'REQUESTED'`),
    // The lifecycle columns always agree with the status.
    check('bookings_pool_accepted', sql`(${t.poolId} IS NULL) = (${t.acceptedAt} IS NULL)`),
    check('bookings_requested_unassigned', sql`${t.status} <> 'REQUESTED' OR ${t.poolId} IS NULL`),
    check(
      'bookings_assigned_has_pool',
      sql`${t.status} NOT IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED') OR ${t.poolId} IS NOT NULL`,
    ),
    check(
      'bookings_arrived_at',
      sql`(${t.status} NOT IN ('DRIVER_ARRIVED', 'STARTED', 'COMPLETED') OR ${t.arrivedAt} IS NOT NULL) AND (${t.arrivedAt} IS NULL OR ${t.acceptedAt} IS NOT NULL)`,
    ),
    check(
      'bookings_started_at',
      sql`(${t.startedAt} IS NOT NULL) = (${t.status} IN ('STARTED', 'COMPLETED'))`,
    ),
    check(
      'bookings_completed_at',
      sql`(${t.completedAt} IS NOT NULL) = (${t.status} = 'COMPLETED')`,
    ),
    check(
      'bookings_seats_range',
      sql`${t.seats} BETWEEN 1 AND ${sql.raw(String(MAX_VEHICLE_CAPACITY))}`,
    ),
    check('bookings_direct_km_positive', sql`${t.directKm} > 0`),
    check(
      'bookings_cancelled_at',
      sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} IS NOT NULL)`,
    ),
    // A passenger holds at most one active booking (FR-P10, FR-C6). The database decides,
    // so two taps racing each other still create one booking (NFR-37).
    uniqueIndex('bookings_one_active_per_passenger')
      .on(t.passengerId)
      .where(sql`${t.status} NOT IN (${finalStatusList})`),
  ],
);

// Every status change, kept forever (FR-R11, NFR-40). A trigger in the migration refuses
// UPDATE and DELETE, so rows can only be added.
export const bookingStatusHistory = pgTable(
  'booking_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    // Null on the row that records the booking being created.
    fromStatus: bookingStatus('from_status'),
    toStatus: bookingStatus('to_status').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    // The pool the booking was in when it changed; for a driver cancel, the one it left.
    poolId: uuid('pool_id').references(() => pools.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('booking_status_history_booking_id_idx').on(t.bookingId)],
);

export type Booking = typeof bookings.$inferSelect;
