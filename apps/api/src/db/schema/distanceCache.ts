import { numeric, pgEnum, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { coordinate } from './columns.js';

// How a distance was measured: by road from the map service, or the straight-line
// fallback (NFR-13). Bookings and fares record it so a breakdown says which one it was.
export const distanceMethod = pgEnum('distance_method', ['routed', 'fallback']);

// Road distances already asked for, so the map service is never asked twice for the same
// pair. The key has a direction: A→B by road is not always B→A. Only routed distances are
// stored; a fallback is cheap to recompute and would stay approximate forever if cached.
export const distanceCache = pgTable(
  'distance_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    originLat: coordinate('origin_lat').notNull(),
    originLng: coordinate('origin_lng').notNull(),
    destLat: coordinate('dest_lat').notNull(),
    destLng: coordinate('dest_lng').notNull(),
    distanceKm: numeric('distance_km', { precision: 7, scale: 3 }).notNull(),
    method: distanceMethod('method').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('distance_cache_pair').on(t.originLat, t.originLng, t.destLat, t.destLng)],
);
