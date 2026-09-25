import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../src/db/client.js';
import { distanceCache } from '../src/db/schema/index.js';
import { createDistanceService, type DistanceService } from '../src/geo/distance.js';
import { fallbackRoadKm, haversineKm } from '../src/geo/haversine.js';
import type { RoutingConfig } from '../src/geo/openRouteService.js';
import { TEST_DATABASE_URL } from './support/db.js';
import { startFakeOrs, type FakeOrs } from './support/fakeOrs.js';

const BANANI = { lat: 23.7937, lng: 90.4066 };
const MOHAKHALI = { lat: 23.7781, lng: 90.405 };
const GULSHAN_1 = { lat: 23.7806, lng: 90.4163 };

let pool: pg.Pool;
let db: Database;
let ors: FakeOrs;
const log = pino({ level: 'silent' });

function service(overrides: Partial<RoutingConfig> = {}): DistanceService {
  return createDistanceService(db, {
    apiKey: 'test-key',
    baseUrl: ors.baseUrl,
    timeoutMs: 1_000,
    ...overrides,
  });
}

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL);
  db = createDb(pool);
  ors = await startFakeOrs();
});

afterAll(async () => {
  await ors.close();
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${distanceCache}`);
  ors.hits = 0;
  ors.matrixHits = 0;
  ors.behave({ kind: 'route', meters: 2345.6 });
});

describe('straight-line fallback (FR-L2)', () => {
  it('measures the great-circle distance', () => {
    // One degree of latitude is about 111.19 km everywhere.
    expect(haversineKm({ lat: 23, lng: 90 }, { lat: 24, lng: 90 })).toBeCloseTo(111.195, 3);
  });

  it('stretches it by 1.3 and keeps it to the metre', () => {
    const km = fallbackRoadKm(BANANI, MOHAKHALI);

    expect(km).toMatch(/^\d+\.\d{3}$/);
    expect(Number(km)).toBeCloseTo(haversineKm(BANANI, MOHAKHALI) * 1.3, 3);
  });
});

describe('road distance (FR-L1, NFR-13)', () => {
  it('uses the routed distance, in km to 3 decimal places', async () => {
    expect(await service().roadKm(BANANI, MOHAKHALI, log)).toEqual({
      km: '2.346',
      method: 'routed',
    });
    // ORS takes [lng, lat]. The key travels in a header, never the URL.
    expect(ors.lastCoordinates).toEqual([
      [BANANI.lng, BANANI.lat],
      [MOHAKHALI.lng, MOHAKHALI.lat],
    ]);
    expect(ors.lastAuthorization).toBe('test-key');
  });

  it('caches a routed distance, so the map service is asked once', async () => {
    await service().roadKm(BANANI, MOHAKHALI, log);
    ors.behave({ kind: 'status', status: 500 });

    expect(await service().roadKm(BANANI, MOHAKHALI, log)).toEqual({
      km: '2.346',
      method: 'routed',
    });
    expect(ors.hits).toBe(1);
  });

  it('keeps the direction in the cache key', async () => {
    await service().roadKm(BANANI, MOHAKHALI, log);
    await service().roadKm(MOHAKHALI, BANANI, log);

    expect(ors.hits).toBe(2);
  });

  it('falls back without calling the map service when no key is set', async () => {
    const result = await service({ apiKey: undefined }).roadKm(BANANI, MOHAKHALI, log);

    expect(result).toEqual({ km: fallbackRoadKm(BANANI, MOHAKHALI), method: 'fallback' });
    expect(ors.hits).toBe(0);
  });

  it.each([
    ['a server error', 500],
    ['running out of quota', 429],
    ['an unroutable point', 404],
  ])('falls back on %s', async (_name, status) => {
    ors.behave({ kind: 'status', status });

    expect((await service().roadKm(BANANI, MOHAKHALI, log)).method).toBe('fallback');
  });

  it.each([
    ['no routes', { routes: [] }],
    ['no distance', { routes: [{ summary: {} }] }],
    ['a zero distance', { routes: [{ summary: { distance: 0 } }] }],
    ['a distance that is not a number', { routes: [{ summary: { distance: '5000' } }] }],
  ])('falls back on a response with %s', async (_name, body) => {
    ors.behave({ kind: 'body', body });

    expect((await service().roadKm(BANANI, MOHAKHALI, log)).method).toBe('fallback');
  });

  it('falls back when the map service is unreachable', async () => {
    const unreachable = service({ baseUrl: 'http://127.0.0.1:1' });

    expect((await unreachable.roadKm(BANANI, MOHAKHALI, log)).method).toBe('fallback');
  });

  it('falls back when no answer comes within the timeout', async () => {
    ors.behave({ kind: 'hang' });

    const result = await service({ timeoutMs: 200 }).roadKm(BANANI, MOHAKHALI, log);
    expect(result.method).toBe('fallback');
  });

  it('waits for a slow answer that arrives within the timeout', async () => {
    ors.behave({ kind: 'route', meters: 5000, delayMs: 300 });

    const result = await service({ timeoutMs: 1_000 }).roadKm(BANANI, MOHAKHALI, log);
    expect(result).toEqual({ km: '5.000', method: 'routed' });
  });

  it('never caches a fallback, so a recovered map service is used next time', async () => {
    ors.behave({ kind: 'status', status: 503 });
    await service().roadKm(BANANI, MOHAKHALI, log);
    ors.behave({ kind: 'route', meters: 5000 });

    expect(await service().roadKm(BANANI, MOHAKHALI, log)).toEqual({
      km: '5.000',
      method: 'routed',
    });
    expect(await db.$count(distanceCache)).toBe(1);
  });
});

describe("a route's legs (phase 5 LLD §4)", () => {
  const points = [BANANI, MOHAKHALI, GULSHAN_1];

  it('measures every pair with one matrix request and caches them', async () => {
    const leg = await service().legKm(points, log);

    expect(ors.matrixHits).toBe(1);
    expect(ors.lastLocations).toEqual(points.map((point) => [point.lng, point.lat]));
    expect(leg?.(BANANI, GULSHAN_1)).toEqual({ km: '2.346', method: 'routed' });
    expect(leg?.(GULSHAN_1, MOHAKHALI)).toEqual({ km: '2.346', method: 'routed' });
    expect(await db.$count(distanceCache)).toBe(6);

    ors.behave({ kind: 'status', status: 500 });
    const again = await service().legKm(points, log);
    expect(again?.(MOHAKHALI, BANANI)).toEqual({ km: '2.346', method: 'routed' });
    expect(ors.matrixHits).toBe(1);
  });

  it('asks only about pairs the cache lacks', async () => {
    await service().roadKm(BANANI, MOHAKHALI, log);
    await service().roadKm(MOHAKHALI, BANANI, log);
    ors.behave({ kind: 'route', meters: 1000 });

    const leg = await service().legKm(points, log);
    expect(leg?.(BANANI, MOHAKHALI).km).toBe('2.346');
    expect(leg?.(BANANI, GULSHAN_1).km).toBe('1.000');
    expect(ors.matrixHits).toBe(1);
  });

  it('asks nothing when every pair is cached, or the points are the same place', async () => {
    await service().legKm(points, log);
    ors.matrixHits = 0;

    const leg = await service().legKm([...points, BANANI], log);
    expect(leg?.(BANANI, BANANI)).toEqual({ km: '0.000', method: 'routed' });
    expect(await service().legKm([BANANI, BANANI], log)).not.toBeNull();
    expect(ors.matrixHits).toBe(0);
  });

  it('refuses a leg it was never asked about', async () => {
    const leg = await service().legKm([BANANI, MOHAKHALI], log);

    expect(() => leg?.(BANANI, GULSHAN_1)).toThrow();
  });

  it('falls back for every pair, asking nothing, when no key is set', async () => {
    const leg = await service({ apiKey: undefined }).legKm(points, log, { remaining: 0 });

    expect(leg?.(BANANI, GULSHAN_1)).toEqual({
      km: fallbackRoadKm(BANANI, GULSHAN_1),
      method: 'fallback',
    });
    expect(ors.hits).toBe(0);
  });

  it.each([
    ['a server error', { kind: 'status', status: 500 }],
    ['running out of quota', { kind: 'status', status: 429 }],
    ['a malformed body', { kind: 'body', body: { distances: [[0]] } }],
  ] as const)('falls back on %s, and caches nothing', async (_name, behaviour) => {
    ors.behave(behaviour);

    const leg = await service().legKm(points, log);
    expect(leg?.(MOHAKHALI, GULSHAN_1).method).toBe('fallback');
    expect(await db.$count(distanceCache)).toBe(0);
  });

  it('falls back when no answer comes within the timeout', async () => {
    ors.behave({ kind: 'hang' });

    const leg = await service({ timeoutMs: 200 }).legKm(points, log);
    expect(leg?.(BANANI, MOHAKHALI).method).toBe('fallback');
  });

  it('falls back only for the pairs with no route', async () => {
    const toGulshan = (to: number[]) => to[0] === GULSHAN_1.lng;
    ors.behave({ kind: 'distances', meters: (_from, to) => (toGulshan(to) ? null : 3000) });

    const leg = await service().legKm(points, log);
    expect(leg?.(BANANI, GULSHAN_1).method).toBe('fallback');
    expect(leg?.(GULSHAN_1, BANANI)).toEqual({ km: '3.000', method: 'routed' });
    expect(await db.$count(distanceCache)).toBe(4);
  });

  it('spends the budget only on a map request, and waits when it is spent', async () => {
    const budget = { remaining: 1 };

    expect(await service().legKm([BANANI, MOHAKHALI], log, budget)).not.toBeNull();
    expect(budget.remaining).toBe(0);
    expect(await service().legKm(points, log, budget)).toBeNull();
    expect(ors.matrixHits).toBe(1);
    // Cached pairs cost nothing.
    expect(await service().legKm([MOHAKHALI, BANANI], log, budget)).not.toBeNull();
  });
});
