import { parseCookie } from 'cookie';
import type { Request, RequestHandler } from 'express';
import { SESSION_COOKIE, verifySession, type Session } from '../../auth/session.js';
import { AppError } from '../errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: Session;
  }
}

function unauthenticated(): AppError {
  return new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
}

// Every protected route starts here: no valid session cookie means 401 (NFR-8).
export function requireAuth(sessionSecret: string): RequestHandler {
  return async (req, _res, next) => {
    const token = parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE];
    const session = token ? await verifySession(token, sessionSecret) : null;
    if (!session) throw unauthenticated();
    req.auth = session;
    next();
  };
}

// Runs after requireAuth. A passenger on a driver route (or the reverse) gets 403.
export function requireRole(role: Session['role']): RequestHandler {
  return (req, _res, next) => {
    const session = currentSession(req);
    if (session.role !== role) {
      throw new AppError(403, 'WRONG_ROLE', `Only ${role}s can do this.`);
    }
    next();
  };
}

// The session set by requireAuth, for handlers mounted behind it.
export function currentSession(req: Request): Session {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
