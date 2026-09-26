import { Router } from 'express';
import { requireAuth, requireRole } from '../../http/middleware/auth.js';
import { listNearbyTeslas } from '../../services/nearbyTeslas.js';
import type { V1Deps } from './index.js';
import { nearbyQuery } from './schemas.js';

// The Teslas near a pickup, for a passenger to look at before requesting (passenger nearby
// Teslas LLD). Polled every 4 seconds while a pickup is set (NFR-3).
export function nearbyTeslasRouter(deps: V1Deps): Router {
  const router = Router();

  router.get('/', requireAuth(deps.session.secret), requireRole('passenger'), async (req, res) => {
    const near = nearbyQuery.parse(req.query);
    res.json(await listNearbyTeslas(deps.db, near, deps.dispatch.searchRadiusKm));
  });

  return router;
}
