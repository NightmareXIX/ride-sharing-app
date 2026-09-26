import { Router } from 'express';
import { requireAuth, requireRole } from '../../http/middleware/auth.js';
import { quoteTrip } from '../../services/bookings.js';
import { pathBetween } from '../../services/paths.js';
import type { V1Deps } from './index.js';
import { trip } from './schemas.js';

// The price of a trip before booking it (FR-P4), with its road to draw (route-paths LLD
// §3). The road is looked up alongside the distance, and a failed one is a straight line,
// never an error. Nothing is booked.
export function fareEstimatesRouter(deps: V1Deps): Router {
  const router = Router();

  router.post('/', requireAuth(deps.session.secret), requireRole('passenger'), async (req, res) => {
    const input = trip.parse(req.body);
    const [quote, path] = await Promise.all([
      quoteTrip(deps, req.log, input),
      pathBetween(deps.paths, req.log, input.pickup, input.destination),
    ]);
    res.json({ ...quote, path });
  });

  return router;
}
