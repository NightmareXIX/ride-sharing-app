import { parseSetCookie, type SetCookie } from 'cookie';
import type pg from 'pg';
import { SESSION_COOKIE } from '../../src/auth/session.js';
import type { TestServer } from './server.js';

export const PASSWORD = 'correct-horse-battery';

// Empties every table. users cascades to wallets, vehicles, bookings and their history;
// the distance and road-shape caches stand alone, and a routed leg left there would leak
// between tests.
export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE users, distance_cache, route_path_cache CASCADE');
}

export function passengerSignUp(overrides: Record<string, unknown> = {}) {
  return {
    role: 'passenger',
    name: 'Nusrat',
    email: 'nusrat@example.com',
    password: PASSWORD,
    gender: 'female',
    ...overrides,
  };
}

export function driverSignUp(overrides: Record<string, unknown> = {}) {
  return {
    role: 'driver',
    name: 'Jashim',
    email: 'jashim@example.com',
    password: PASSWORD,
    gender: 'male',
    vehicle: { name: 'Bullet', capacity: 3 },
    ...overrides,
  };
}

export function sendJson(
  server: TestServer,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return fetch(server.url(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body),
  });
}

export function postJson(
  server: TestServer,
  path: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return sendJson(server, 'POST', path, body, cookie);
}

export function getJson(server: TestServer, path: string, cookie?: string): Promise<Response> {
  return fetch(server.url(path), { headers: cookie ? { Cookie: cookie } : {} });
}

// The session cookie a response set, parsed, or undefined if it set none.
export function sessionSetCookie(res: Response): SetCookie | undefined {
  return res.headers
    .getSetCookie()
    .map((header) => parseSetCookie(header))
    .find((cookie) => cookie.name === SESSION_COOKIE);
}

// A Cookie request header carrying the session a response set.
export function sessionCookieHeader(res: Response): string {
  const cookie = sessionSetCookie(res);
  if (!cookie?.value) throw new Error('The response set no session cookie');
  return `${SESSION_COOKIE}=${cookie.value}`;
}

export async function signUpAs(server: TestServer, body: unknown): Promise<string> {
  const res = await postJson(server, '/api/v1/auth/signup', body);
  if (res.status !== 201) throw new Error(`Sign-up failed with ${res.status}`);
  return sessionCookieHeader(res);
}
