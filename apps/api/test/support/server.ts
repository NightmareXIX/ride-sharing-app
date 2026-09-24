import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { pino } from 'pino';
import { createApp } from '../../src/app.js';

export interface TestServer {
  url: (path: string) => string;
  close: () => Promise<void>;
}

// Runs the real app on a random port so tests go through the full HTTP stack with fetch.
export async function startTestServer(pool: pg.Pool): Promise<TestServer> {
  const app = createApp({ logger: pino({ level: 'silent' }), pool });
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
