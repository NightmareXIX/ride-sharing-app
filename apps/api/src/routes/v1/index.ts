import { Router } from 'express';
import type { SessionConfig } from '../../auth/session.js';
import type { Database } from '../../db/client.js';
import type { DistanceService } from '../../geo/distance.js';
import { authRouter } from './auth.js';
import { driverRouter } from './driver.js';
import { fareEstimatesRouter } from './fareEstimates.js';
import { meRouter } from './me.js';

export interface V1Deps {
  db: Database;
  session: SessionConfig;
  distance: DistanceService;
}

// Every product route is mounted under /api/v1 (NFR-34). Feature phases add their routers here.
export function v1Router(deps: V1Deps): Router {
  const router = Router();
  router.use('/auth', authRouter(deps));
  router.use('/me', meRouter(deps));
  router.use('/driver', driverRouter(deps));
  router.use('/fare-estimates', fareEstimatesRouter(deps));
  return router;
}
