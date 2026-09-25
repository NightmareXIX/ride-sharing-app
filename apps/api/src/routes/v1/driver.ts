import { Router } from 'express';
import { currentSession, requireAuth, requireRole } from '../../http/middleware/auth.js';
import {
  acceptRequest,
  completeTrip,
  driverCancel,
  getDriverTrip,
  markArrived,
  startTrip,
} from '../../services/pools.js';
import { listNearbyRequests } from '../../services/requests.js';
import { getDriverVehicle, goOffline, goOnline, setLocation } from '../../services/vehicles.js';
import type { V1Deps } from './index.js';
import { bookingId, location } from './schemas.js';

// The driver's Tesla, availability and rides (API Routes §6–8). Drivers only (NFR-8).
export function driverRouter(deps: V1Deps): Router {
  const { db, session, dispatch } = deps;
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

  // Accepting twice returns the same trip (FR-C5, NFR-37).
  router.post('/requests/:bookingId/accept', async (req, res) => {
    const id = bookingId(req.params.bookingId);
    const driverId = currentSession(req).userId;
    res.json({ pool: await acceptRequest(deps, req.log, driverId, id, dispatch) });
  });

  // The trip in progress, polled every 4 seconds (NFR-3).
  router.get('/pool', async (req, res) => {
    res.json({ pool: await getDriverTrip(db, currentSession(req).userId) });
  });

  // One passenger's ride, a step at a time (FR-D10). Each returns the trip after the step.
  router.post('/bookings/:id/arrive', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json({ pool: await markArrived(db, currentSession(req).userId, id) });
  });

  router.post('/bookings/:id/start', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json({ pool: await startTrip(db, currentSession(req).userId, id) });
  });

  // Also returns the recorded fare for the driver to collect.
  router.post('/bookings/:id/complete', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json(await completeTrip(db, currentSession(req).userId, id));
  });

  // Before pickup only. The request goes back to other drivers, and the route is re-planned
  // without it (FR-D12).
  router.post('/bookings/:id/cancel', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json({ pool: await driverCancel(deps, req.log, currentSession(req).userId, id) });
  });

  return router;
}
