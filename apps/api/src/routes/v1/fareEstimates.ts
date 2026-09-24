import { Router } from 'express';
import { requireAuth, requireRole } from '../../http/middleware/auth.js';
import { quoteTrip } from '../../services/bookings.js';
import type { V1Deps } from './index.js';
import { trip } from './schemas.js';

// The price of a trip before booking it (FR-P4). Nothing is booked.
export function fareEstimatesRouter(deps: V1Deps): Router {
  const router = Router();

  router.post('/', requireAuth(deps.session.secret), requireRole('passenger'), async (req, res) => {
    res.json(await quoteTrip(deps, req.log, trip.parse(req.body)));
  });

  return router;
}
