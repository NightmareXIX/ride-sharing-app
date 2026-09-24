import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import { TEST_DATABASE_URL } from './support/db.js';
import { startTestServer, type TestServer } from './support/server.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

describe('error envelope (NFR-35)', () => {
  it('answers an unknown /api/v1 route with 404 NOT_FOUND', async () => {
    const res = await fetch(server.url('/api/v1/no-such-route'));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });

  it('answers a malformed JSON body with 400 VALIDATION_ERROR', async () => {
    const res = await fetch(server.url('/api/v1/bookings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"seats": 2,',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'The request body is not valid JSON.' },
    });
  });
});

describe('request id (NFR-42)', () => {
  it('generates an id when the caller sends none', async () => {
    const res = await fetch(server.url('/health'));
    expect(res.headers.get('x-request-id')).toMatch(UUID);
  });

  it('keeps a well-formed id from upstream', async () => {
    const res = await fetch(server.url('/health'), {
      headers: { 'X-Request-Id': 'proxy-trace-0001' },
    });
    expect(res.headers.get('x-request-id')).toBe('proxy-trace-0001');
  });

  it('replaces an id that could inject text into the logs', async () => {
    const res = await fetch(server.url('/health'), {
      headers: { 'X-Request-Id': 'bad id with spaces' },
    });
    expect(res.headers.get('x-request-id')).toMatch(UUID);
  });

  it('is sent on error responses too', async () => {
    const res = await fetch(server.url('/api/v1/no-such-route'));
    expect(res.headers.get('x-request-id')).toMatch(UUID);
  });
});
