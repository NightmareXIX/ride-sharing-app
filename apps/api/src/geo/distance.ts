import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { distanceCache, type distanceMethod } from '../db/schema/index.js';
import type { Logger } from '../logger.js';
import { fallbackRoadKm } from './haversine.js';
import { drivingMeters, type RoutingConfig } from './openRouteService.js';
import type { LatLng } from './serviceArea.js';

// The app waits this long for the map service before using the fallback (NFR-13).
export const ROUTING_TIMEOUT_MS = 10_000;

// Slower than this misses the speed target (NFR-2) and is worth a warning (NFR-44).
const SLOW_ROUTING_MS = 4_000;

export type DistanceMethod = (typeof distanceMethod.enumValues)[number];

export interface RoadDistance {
  // Km to 3 decimal places, as a string, e.g. "5.000".
  km: string;
  method: DistanceMethod;
}

export interface DistanceService {
  roadKm(from: LatLng, to: LatLng, log: Logger): Promise<RoadDistance>;
}

// Road distance: the cache first, then OpenRouteService, and the straight-line fallback
// only when the map service can't answer. Being slow is not a reason to fall back.
export function createDistanceService(db: Database, routing: RoutingConfig): DistanceService {
  return {
    async roadKm(from, to, log) {
      const pair = and(
        eq(distanceCache.originLat, from.lat),
        eq(distanceCache.originLng, from.lng),
        eq(distanceCache.destLat, to.lat),
        eq(distanceCache.destLng, to.lng),
      );
      const [cached] = await db
        .select({ km: distanceCache.distanceKm, method: distanceCache.method })
        .from(distanceCache)
        .where(pair);
      if (cached) return cached;

      const startedAt = performance.now();
      const result = await drivingMeters(routing, from, to);
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs > SLOW_ROUTING_MS) {
        log.warn({ elapsedMs }, 'Map service was slower than the 4 s target');
      }

      if (!result.ok) {
        log.warn({ reason: result.reason, elapsedMs }, 'Map service unavailable; using fallback');
        return { km: fallbackRoadKm(from, to), method: 'fallback' };
      }

      const km = (result.meters / 1000).toFixed(3);
      await db
        .insert(distanceCache)
        .values({
          originLat: from.lat,
          originLng: from.lng,
          destLat: to.lat,
          destLng: to.lng,
          distanceKm: km,
          method: 'routed',
        })
        .onConflictDoNothing();
      return { km, method: 'routed' };
    },
  };
}
