import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import { TEST_DATABASE_URL, UNREACHABLE_DATABASE_URL } from './support/db.js';
import { startTestServer, type TestServer } from './support/server.js';

describe('health checks (NFR-15)', () => {
  describe('with the database up', () => {
    let pool: pg.Pool;
    let server: TestServer;

    beforeAll(async () => {
      pool = createPool(TEST_DATABASE_URL);
      server = await startTestServer(pool);
    });

    afterAll(async () => {
      await server.close();
      await pool.end();
    });

    it('reports liveness', async () => {
      const res = await fetch(server.url('/health'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    });

    it('reports ready when the database answers', async () => {
      const res = await fetch(server.url('/health/ready'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok', database: 'up' });
    });
  });

  describe('with the database unreachable', () => {
    let pool: pg.Pool;
    let server: TestServer;

    beforeAll(async () => {
      pool = createPool(UNREACHABLE_DATABASE_URL);
      server = await startTestServer(pool);
    });

    afterAll(async () => {
      await server.close();
      await pool.end();
    });

    it('stays live', async () => {
      const res = await fetch(server.url('/health'));
      expect(res.status).toBe(200);
    });

    it('reports not ready with 503', async () => {
      const res = await fetch(server.url('/health/ready'));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: 'unavailable', database: 'down' });
    });
  });
});
