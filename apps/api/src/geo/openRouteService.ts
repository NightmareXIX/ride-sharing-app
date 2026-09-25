import type { LatLng } from './serviceArea.js';

export interface RoutingConfig {
  // Unset means every distance uses the fallback, e.g. on an evaluator's machine.
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
}

export type RouteResult = { ok: true; meters: number } | { ok: false; reason: string };

interface DirectionsBody {
  routes?: Array<{ summary?: { distance?: unknown } }>;
}

// Asks OpenRouteService for the driving distance between two points. Every way it can
// fail becomes a reason rather than an exception, so the caller decides what to do.
export async function drivingMeters(
  config: RoutingConfig,
  from: LatLng,
  to: LatLng,
): Promise<RouteResult> {
  if (!config.apiKey) return { ok: false, reason: 'no_api_key' };

  let body: DirectionsBody;
  try {
    const res = await fetch(new URL('/v2/directions/driving-car', config.baseUrl), {
      method: 'POST',
      // The key goes in a header, never in the URL, so it can't end up in a log (NFR-43).
      headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
      // Covers reading the body too, so a stalled response can't hang the request.
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    // Covers 429 (quota used up) and ORS's "point not routable" errors alike.
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    body = (await res.json()) as DirectionsBody;
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return { ok: false, reason: timedOut ? 'timeout' : 'network_error' };
  }

  const meters = body.routes?.[0]?.summary?.distance;
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) {
    return { ok: false, reason: 'malformed_response' };
  }
  return { ok: true, meters };
}

// `meters[i][j]` is the drive from point i to point j, or null where ORS found no route.
export type MatrixResult =
  { ok: true; meters: (number | null)[][] } | { ok: false; reason: string };

interface MatrixBody {
  distances?: unknown;
}

function isRoadMeters(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

// Asks OpenRouteService for the driving distance between every pair of points, in one
// request. A route check needs many pairs; asking for each would soon use up the free
// quota and miss the 4-second target (NFR-2). Failures come back as reasons, as above.
export async function drivingMatrix(
  config: RoutingConfig,
  points: readonly LatLng[],
): Promise<MatrixResult> {
  if (!config.apiKey) return { ok: false, reason: 'no_api_key' };

  let body: MatrixBody;
  try {
    const res = await fetch(new URL('/v2/matrix/driving-car', config.baseUrl), {
      method: 'POST',
      headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: points.map((point) => [point.lng, point.lat]),
        metrics: ['distance'],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    body = (await res.json()) as MatrixBody;
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return { ok: false, reason: timedOut ? 'timeout' : 'network_error' };
  }

  const rows = body.distances;
  const wellFormed =
    Array.isArray(rows) &&
    rows.length === points.length &&
    rows.every(
      (row) => Array.isArray(row) && row.length === points.length && row.every(isRoadMeters),
    );
  if (!wellFormed) return { ok: false, reason: 'malformed_response' };
  return { ok: true, meters: rows as (number | null)[][] };
}
