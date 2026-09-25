import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { pino } from 'pino';
import { createApp } from '../../src/app.js';
import type { DispatchConfig } from '../../src/domain/dispatch.js';
import type { RoutingConfig } from '../../src/geo/openRouteService.js';

// Only for tests; the real secret comes from SESSION_SECRET.
export const TEST_SESSION_SECRET = 'test-only-session-secret-0123456789abcdef';

export interface TestServer {
  url: (path: string) => string;
  close: () => Promise<void>;
}

// No key by default, so distances use the fallback and tests never call the real map
// service (NFR-28). Tests of the routing path point baseUrl at a local stub instead.
export const NO_ROUTING: RoutingConfig = { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1_000 };

// The default radius from FR §2.
const DEFAULT_DISPATCH: DispatchConfig = { searchRadiusKm: 2 };

// Runs the real app on a random port so tests go through the full HTTP stack with fetch.
export async function startTestServer(
  pool: pg.Pool,
  routing: RoutingConfig = NO_ROUTING,
  dispatch: DispatchConfig = DEFAULT_DISPATCH,
): Promise<TestServer> {
  const app = createApp({
    logger: pino({ level: 'silent' }),
    pool,
    session: { secret: TEST_SESSION_SECRET, secure: false },
    routing,
    dispatch,
  });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
