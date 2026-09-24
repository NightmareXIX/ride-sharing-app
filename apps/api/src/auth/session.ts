import type { CookieOptions } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { userRole, type User } from '../db/schema/index.js';

export const SESSION_COOKIE = 'tp_session';

// A login lasts 24 hours from sign-in and does not slide (NFR-6).
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

const ALGORITHM = 'HS256';

export interface Session {
  userId: string;
  role: User['role'];
}

export interface SessionConfig {
  secret: string;
  secure: boolean;
}

function signingKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// Stateless: the signed token is the whole session, so there is no sessions table
// (Core Entities §3). The role rides along because it never changes after sign-up.
export async function signSession(
  session: Session,
  secret: string,
  issuedAt: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(issuedAt.getTime() / 1000);
  return new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(session.userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SECONDS)
    .sign(signingKey(secret));
}

// Returns null for anything that isn't a valid, unexpired token we signed.
export async function verifySession(token: string, secret: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), { algorithms: [ALGORITHM] });
    const role = userRole.enumValues.find((value) => value === payload.role);
    if (typeof payload.sub !== 'string' || role === undefined) return null;
    return { userId: payload.sub, role };
  } catch {
    return null;
  }
}

// HttpOnly keeps the token away from page scripts (NFR-6). Lax stops browsers sending it
// on cross-site POSTs, which covers CSRF for a JSON-only API.
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}
