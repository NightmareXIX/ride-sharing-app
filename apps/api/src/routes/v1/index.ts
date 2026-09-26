import { Router } from 'express';
import type { SessionConfig } from '../../auth/session.js';
import type { Database } from '../../db/client.js';
import type { DispatchConfig } from '../../domain/dispatch.js';
import type { DistanceService } from '../../geo/distance.js';
import type { PathService } from '../../geo/path.js';
import { authRouter } from './auth.js';
import { bookingsRouter } from './bookings.js';
import { driverRouter } from './driver.js';
import { fareEstimatesRouter } from './fareEstimates.js';
import { meRouter } from './me.js';
import { nearbyTeslasRouter } from './nearbyTeslas.js';
import { walletRouter } from './wallet.js';

export interface V1Deps {
  db: Database;
  session: SessionConfig;
  distance: DistanceService;
  // Road shapes for the map only (route-paths LLD).
  paths: PathService;
  dispatch: DispatchConfig;
}

// Every product route is mounted under /api/v1 (NFR-34). Feature phases add their routers here.
export function v1Router(deps: V1Deps): Router {
  const router = Router();
  router.use('/auth', authRouter(deps));
  router.use('/me', meRouter(deps));
  router.use('/driver', driverRouter(deps));
  router.use('/nearby-teslas', nearbyTeslasRouter(deps));
  router.use('/fare-estimates', fareEstimatesRouter(deps));
  router.use('/bookings', bookingsRouter(deps));
  router.use('/wallet', walletRouter(deps));
  return router;
}
