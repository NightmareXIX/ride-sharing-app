import { Router } from 'express';
import { currentSession, requireAuth, requireRole } from '../../http/middleware/auth.js';
import { listNearbyRequests } from '../../services/requests.js';
import { getDriverVehicle, goOffline, goOnline, setLocation } from '../../services/vehicles.js';
import type { V1Deps } from './index.js';
import { location } from './schemas.js';

// The driver's Tesla, availability and rides (API Routes §6–8). Drivers only (NFR-8).
export function driverRouter({ db, session, dispatch }: V1Deps): Router {
  const router = Router();
  router.use(requireAuth(session.secret), requireRole('driver'));

  router.get('/vehicle', async (req, res) => {
    res.json({ vehicle: await getDriverVehicle(db, currentSession(req).userId) });
  });

  router.post('/vehicle/online', async (req, res) => {
    res.json({ vehicle: await goOnline(db, currentSession(req).userId) });
  });

  router.post('/vehicle/offline', async (req, res) => {
    res.json({ vehicle: await goOffline(db, currentSession(req).userId) });
  });

  router.put('/vehicle/location', async (req, res) => {
    const body = location.parse(req.body);
    res.json({ vehicle: await setLocation(db, currentSession(req).userId, body) });
  });

  // Polled every 4 seconds while the driver is online (NFR-3).
  router.get('/requests', async (req, res) => {
    res.json({ requests: await listNearbyRequests(db, currentSession(req).userId, dispatch) });
  });

  return router;
}
