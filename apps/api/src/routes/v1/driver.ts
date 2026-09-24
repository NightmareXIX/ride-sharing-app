import { Router } from 'express';
import { currentSession, requireAuth, requireRole } from '../../http/middleware/auth.js';
import { getDriverVehicle, goOffline, goOnline, setLocation } from '../../services/vehicles.js';
import type { V1Deps } from './index.js';
import { location } from './schemas.js';

// The driver's Tesla and availability (API Routes §6). Drivers only (NFR-8).
export function driverRouter({ db, session }: V1Deps): Router {
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

  return router;
}
