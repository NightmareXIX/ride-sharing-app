import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../src/db/client.js';
import { routePathCache } from '../src/db/schema/index.js';
import type { RoutingConfig } from '../src/geo/openRouteService.js';
import { createPathService, type PathService } from '../src/geo/path.js';
import { TEST_DATABASE_URL } from './support/db.js';
import { startFakeOrs, type FakeOrs } from './support/fakeOrs.js';

const BANANI = { lat: 23.7937, lng: 90.4066 };
const MOHAKHALI = { lat: 23.7812, lng: 90.409 };
const GULSHAN_1 = { lat: 23.7806, lng: 90.4163 };

let pool: pg.Pool;
let db: Database;
let ors: FakeOrs;
const log = pino({ level: 'silent' });

function service(overrides: Partial<RoutingConfig> = {}): PathService {
  return createPathService(db, {
    apiKey: 'test-key',
    baseUrl: ors.baseUrl,
    timeoutMs: 1_000,
    ...overrides,
  });
}

const straight = (...points: { lat: number; lng: number }[]) =>
  points.map((point) => [point.lat, point.lng]);

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
  await db.execute(sql`TRUNCATE ${routePathCache}`);
  ors.hits = 0;
  ors.directionsHits = 0;
  ors.behave({ kind: 'route', meters: 2000 });
});

describe('road shapes (route-paths LLD §2)', () => {
  it('asks once through every point and gives a leg per pair', async () => {
    const legs = await service().legsThrough([BANANI, MOHAKHALI, GULSHAN_1], log);

    expect(ors.directionsHits).toBe(1);
    expect(ors.lastCoordinates).toEqual([
      [BANANI.lng, BANANI.lat],
      [MOHAKHALI.lng, MOHAKHALI.lat],
      [GULSHAN_1.lng, GULSHAN_1.lat],
    ]);
    expect(legs).toEqual([
      { method: 'routed', points: straight(BANANI, MOHAKHALI) },
      { method: 'routed', points: straight(MOHAKHALI, GULSHAN_1) },
    ]);
  });

  it('caches each leg, so the map service is asked once', async () => {
    const first = await service().legsThrough([BANANI, MOHAKHALI, GULSHAN_1], log);
    ors.behave({ kind: 'status', status: 500 });

    expect(await service().legsThrough([BANANI, MOHAKHALI, GULSHAN_1], log)).toEqual(first);
    // A single leg of that path is cached too.
    expect(await service().legsThrough([MOHAKHALI, GULSHAN_1], log)).toEqual([first[1]]);
    expect(ors.directionsHits).toBe(1);
  });

  it('draws straight fallback lines when the map service fails, and caches none', async () => {
    ors.behave({ kind: 'status', status: 503 });

    expect(await service().legsThrough([BANANI, MOHAKHALI], log)).toEqual([
      { method: 'fallback', points: straight(BANANI, MOHAKHALI) },
    ]);
    const rows = await db.select().from(routePathCache);
    expect(rows).toHaveLength(0);
  });

  it('falls back without a key, asking nothing', async () => {
    const legs = await service({ apiKey: undefined }).legsThrough([BANANI, MOHAKHALI], log);

    expect(legs).toEqual([{ method: 'fallback', points: straight(BANANI, MOHAKHALI) }]);
    expect(ors.hits).toBe(0);
  });

  it('falls back on a malformed answer', async () => {
    ors.behave({ kind: 'body', body: { routes: [{ geometry: 'abc', way_points: [0] }] } });

    const legs = await service().legsThrough([BANANI, MOHAKHALI], log);
    expect(legs[0]?.method).toBe('fallback');
  });

  it('gives a leg with no line for a point repeated after itself, asking for it once', async () => {
    const legs = await service().legsThrough([BANANI, BANANI, MOHAKHALI], log);

    expect(legs).toEqual([
      { method: 'routed', points: [] },
      { method: 'routed', points: straight(BANANI, MOHAKHALI) },
    ]);
    expect(ors.lastCoordinates).toEqual([
      [BANANI.lng, BANANI.lat],
      [MOHAKHALI.lng, MOHAKHALI.lat],
    ]);
  });

  it('asks nothing when no leg has a road to draw', async () => {
    expect(await service().legsThrough([BANANI, BANANI], log)).toEqual([
      { method: 'routed', points: [] },
    ]);
    expect(await service().legsThrough([BANANI], log)).toEqual([]);
    expect(ors.hits).toBe(0);
  });
});
