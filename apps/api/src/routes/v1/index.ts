import { Router } from 'express';
import type { SessionConfig } from '../../auth/session.js';
import type { Database } from '../../db/client.js';
import { authRouter } from './auth.js';

export interface V1Deps {
  db: Database;
  session: SessionConfig;
}

// Every product route is mounted under /api/v1 (NFR-34). Feature phases add their routers here.
export function v1Router(deps: V1Deps): Router {
  const router = Router();
  router.use('/auth', authRouter(deps));
  return router;
}
