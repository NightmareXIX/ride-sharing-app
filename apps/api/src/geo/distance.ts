import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { distanceCache, type distanceMethod } from '../db/schema/index.js';
import type { Logger } from '../logger.js';
import { fallbackRoadKm } from './haversine.js';
import { drivingMatrix, drivingMeters, type RoutingConfig } from './openRouteService.js';
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

// The road distance of one leg between two of the points a route check asked about.
export type LegLookup = (from: LatLng, to: LatLng) => RoadDistance;

// How many map requests the caller may still make, shared by the checks of one request.
// A driver's list refresh gets 3 (NFR-3).
export interface MapBudget {
  remaining: number;
}

export interface DistanceService {
  roadKm(from: LatLng, to: LatLng, log: Logger): Promise<RoadDistance>;
  // The road distance between every ordered pair of the points, with at most one map
  // request. Null when that request is needed but the budget is spent.
  legKm(points: readonly LatLng[], log: Logger, budget?: MapBudget): Promise<LegLookup | null>;
}

function pointKey(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

function pairKey(from: LatLng, to: LatLng): string {
  return `${pointKey(from)}>${pointKey(to)}`;
}

// A point to itself: no leg to drive and nothing to ask the map service.
const NO_DISTANCE: RoadDistance = { km: '0.000', method: 'routed' };

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

    async legKm(points, log, budget) {
      const distinct = [...new Map(points.map((point) => [pointKey(point), point])).values()];
      const legs = new Map<string, RoadDistance>();
      const lookup: LegLookup = (from, to) => {
        if (pointKey(from) === pointKey(to)) return NO_DISTANCE;
        const leg = legs.get(pairKey(from, to));
        if (!leg)
          throw new Error(`No distance was measured from ${pointKey(from)} to ${pointKey(to)}`);
        return leg;
      };
      if (distinct.length < 2) return lookup;

      // Every cached pair among the points, in one query.
      const lats = distinct.map((point) => point.lat);
      const lngs = distinct.map((point) => point.lng);
      const cached = await db
        .select()
        .from(distanceCache)
        .where(
          and(
            inArray(distanceCache.originLat, lats),
            inArray(distanceCache.originLng, lngs),
            inArray(distanceCache.destLat, lats),
            inArray(distanceCache.destLng, lngs),
          ),
        );
      for (const row of cached) {
        const from = { lat: row.originLat, lng: row.originLng };
        const to = { lat: row.destLat, lng: row.destLng };
        legs.set(pairKey(from, to), { km: row.distanceKm, method: row.method });
      }

      const missing = distinct.flatMap((from) =>
        distinct
          .filter((to) => to !== from && !legs.has(pairKey(from, to)))
          .map((to) => [from, to] as const),
      );
      if (missing.length === 0) return lookup;

      // Without a key nothing is asked, so it costs no budget.
      if (routing.apiKey && budget) {
        if (budget.remaining <= 0) return null;
        budget.remaining -= 1;
      }

      const asked = [...new Map(missing.flat().map((point) => [pointKey(point), point])).values()];
      const startedAt = performance.now();
      const result = await drivingMatrix(routing, asked);
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs > SLOW_ROUTING_MS) {
        log.warn({ elapsedMs }, 'Map service was slower than the 4 s target');
      }

      const index = new Map(asked.map((point, i) => [pointKey(point), i]));
      const routed: (typeof distanceCache.$inferInsert)[] = [];
      let fallbacks = 0;
      for (const [from, to] of missing) {
        const meters = result.ok
          ? result.meters[index.get(pointKey(from)) ?? -1]?.[index.get(pointKey(to)) ?? -1]
          : null;
        if (typeof meters === 'number' && meters > 0) {
          const km = (meters / 1000).toFixed(3);
          legs.set(pairKey(from, to), { km, method: 'routed' });
          routed.push({
            originLat: from.lat,
            originLng: from.lng,
            destLat: to.lat,
            destLng: to.lng,
            distanceKm: km,
            method: 'routed',
          });
        } else {
          legs.set(pairKey(from, to), { km: fallbackRoadKm(from, to), method: 'fallback' });
          fallbacks += 1;
        }
      }

      if (fallbacks > 0) {
        const reason = result.ok ? 'no_route' : result.reason;
        log.warn(
          { reason, elapsedMs, pairs: fallbacks },
          'Map service unavailable; using fallback',
        );
      }
      // Only routed distances are cached, as for a single distance.
      if (routed.length > 0) await db.insert(distanceCache).values(routed).onConflictDoNothing();
      return lookup;
    },
  };
}
