import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { coordinate } from './columns.js';

// The road shape of each leg already asked for, so the map service is asked once per pair
// (route-paths LLD §2). For drawing only: no distance or fare is ever read from it
// (NFR-41). Like the distance cache, only routed shapes are stored, and A→B is not B→A.
export const routePathCache = pgTable(
  'route_path_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    originLat: coordinate('origin_lat').notNull(),
    originLng: coordinate('origin_lng').notNull(),
    destLat: coordinate('dest_lat').notNull(),
    destLng: coordinate('dest_lng').notNull(),
    // The leg as an encoded polyline, precision 5, as the map service sends it.
    polyline: text('polyline').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('route_path_cache_pair').on(t.originLat, t.originLng, t.destLat, t.destLng)],
);
