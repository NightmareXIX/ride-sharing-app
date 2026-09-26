import { and, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { routePathCache } from '../db/schema/index.js';
import type { Logger } from '../logger.js';
import { SLOW_ROUTING_MS, type DistanceMethod } from './distance.js';
import { drivingPath, type RoutingConfig } from './openRouteService.js';
import { decodePolyline, encodePolyline, pinEnds, splitLegs, type PathPoint } from './polyline.js';
import type { LatLng } from './serviceArea.js';

// The road from one point to the next, for drawing (route-paths LLD §2). A fallback leg is
// the straight line between the two, when the map service can't answer (NFR-13). A leg
// from a point to itself has no points.
export interface PathLeg {
  method: DistanceMethod;
  points: PathPoint[];
}

export interface PathService {
  // One leg per pair of consecutive points, in order, with at most one map request.
  legsThrough(points: readonly LatLng[], log: Logger): Promise<PathLeg[]>;
}

function pointKey(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

function pairKey(from: LatLng, to: LatLng): string {
  return `${pointKey(from)}>${pointKey(to)}`;
}

function straight(from: LatLng, to: LatLng): PathLeg {
  return { method: 'fallback', points: pinEnds(from, to, []) };
}

// Road shapes: the cache first, then one OpenRouteService request through every point,
// and straight lines only when it can't answer. Nothing here is used for distances or
// fares, which come from the distance cache (NFR-41).
export function createPathService(db: Database, routing: RoutingConfig): PathService {
  return {
    async legsThrough(points, log) {
      const pairs = points.slice(1).map((to, i) => [points[i]!, to] as const);
      const legs: (PathLeg | undefined)[] = pairs.map(([from, to]) =>
        pointKey(from) === pointKey(to) ? { method: 'routed', points: [] } : undefined,
      );
      if (legs.every((leg) => leg !== undefined)) return legs as PathLeg[];

      // Every cached leg among the points, in one query.
      const lats = points.map((point) => point.lat);
      const lngs = points.map((point) => point.lng);
      const cached = await db
        .select()
        .from(routePathCache)
        .where(
          and(
            inArray(routePathCache.originLat, lats),
            inArray(routePathCache.originLng, lngs),
            inArray(routePathCache.destLat, lats),
            inArray(routePathCache.destLng, lngs),
          ),
        );
      const shapes = new Map(
        cached.map((row) => [
          pairKey(
            { lat: row.originLat, lng: row.originLng },
            { lat: row.destLat, lng: row.destLng },
          ),
          row.polyline,
        ]),
      );
      pairs.forEach(([from, to], i) => {
        const shape = legs[i] ? undefined : shapes.get(pairKey(from, to));
        if (shape) legs[i] = { method: 'routed', points: pinEnds(from, to, decodePolyline(shape)) };
      });
      if (legs.every((leg) => leg !== undefined)) return legs as PathLeg[];

      // One request through the whole path. A point repeated straight after itself is
      // asked for once, so the map service's legs are the pairs with a road between them.
      const moving = pairs.flatMap((_, i) => (legs[i]?.points.length === 0 ? [] : [i]));
      const asked = [points[0]!, ...moving.map((i) => pairs[i]![1])];
      const startedAt = performance.now();
      const result = await drivingPath(routing, asked);
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs > SLOW_ROUTING_MS) {
        log.warn({ elapsedMs }, 'Map service was slower than the 4 s target');
      }
      const roads = result.ok
        ? splitLegs(decodePolylineSafely(result.polyline), result.wayPoints)
        : null;

      const fresh: (typeof routePathCache.$inferInsert)[] = [];
      let fallbacks = 0;
      moving.forEach((i, k) => {
        if (legs[i]) return;
        const [from, to] = pairs[i]!;
        const road = roads?.[k];
        if (road && road.length > 0) {
          legs[i] = { method: 'routed', points: pinEnds(from, to, road) };
          fresh.push({
            originLat: from.lat,
            originLng: from.lng,
            destLat: to.lat,
            destLng: to.lng,
            polyline: encodePolyline(road),
          });
        } else {
          legs[i] = straight(from, to);
          fallbacks += 1;
        }
      });

      if (fallbacks > 0) {
        const reason = result.ok ? 'malformed_response' : result.reason;
        log.warn(
          { reason, elapsedMs, legs: fallbacks },
          'Map service unavailable; drawing straight lines',
        );
      }
      // Only road shapes are cached, as for distances.
      if (fresh.length > 0) await db.insert(routePathCache).values(fresh).onConflictDoNothing();
      return legs as PathLeg[];
    },
  };
}

function decodePolylineSafely(encoded: string): PathPoint[] {
  try {
    return decodePolyline(encoded);
  } catch {
    return [];
  }
}
